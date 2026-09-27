import React, { useState, useEffect, useRef } from 'react';
import { usePollar } from '@pollar/react';
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import './App.css';

// Necesario para que pdfjs-dist pueda decodificar PDFs en el navegador
// (corre en un Web Worker aparte). Vite resuelve el "?url" al archivo
// final del worker, tanto en desarrollo como en el build de producción.
pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorkerUrl;

// Extensiones de archivo de texto "plano" que se leen tal cual con
// FileReader (sin necesitar ninguna librería). El PDF se maneja aparte
// con pdfjs-dist porque su contenido no es texto plano.
const EXTENSIONES_TEXTO_PLANO = ['.txt', '.md', '.csv', '.rtf', '.json', '.log'];
const ACCEPT_ARCHIVO_TEXTO = [...EXTENSIONES_TEXTO_PLANO, '.pdf'].join(',');

// URL base del backend. Se toma de la variable de entorno VITE_API_URL
// (definida en frontend/.env, frontend/.env.production, etc.) para poder
// cambiar entre backend local y de producción sin tocar el código.
// Ejemplos:
//   Desarrollo local:  VITE_API_URL=http://localhost:8000
//   Producción:        VITE_API_URL=https://metztli.onrender.com
const API_URL = import.meta.env.VITE_API_URL;

if (!API_URL) {
  // Aviso temprano y visible en consola si alguien olvida definir la
  // variable: mejor fallar rápido que apuntar silenciosamente a "undefined".
  console.error(
    'Falta la variable de entorno VITE_API_URL. Define un archivo .env en frontend/ ' +
    '(por ejemplo VITE_API_URL=http://localhost:8000) y reinicia "npm run dev".'
  );
}

// Clave de almacenamiento y duración de la sesión local. La sesión ya no se
// cierra al recargar la página: se guarda con una hora de expiración y se
// revisa periódicamente para cerrarla sola cuando ese tiempo pasa.
const SESSION_STORAGE_KEY = 'metztli_sesion_local';
const SESSION_DURATION_MS = 60 * 60 * 1000; // 1 hora
const SESSION_CHECK_INTERVAL_MS = 30 * 1000; // revisa cada 30s

// Estas son EXACTAMENTE las mismas categorías que ya usa el backend/IA
// (ver backend/app/services/gemini_ai.py -> CATEGORIAS_VALIDAS).
const CATEGORIAS = {
  autentico: {
    etiqueta: 'Auténtico / Humano',
    color: '#4ade80',
    descripcion: 'Sin señales relevantes de manipulación o generación por IA.',
  },
  generado_por_ia: {
    etiqueta: 'Generado por IA',
    color: '#f87171',
    descripcion: 'El contenido parece generado total o mayoritariamente por un modelo de IA.',
  },
  manipulado: {
    etiqueta: 'Manipulado',
    color: '#fbbf24',
    descripcion: 'Se detectaron señales de alteración, edición o contenido engañoso.',
  },
  no_concluyente: {
    etiqueta: 'No concluyente',
    color: '#9ca3af',
    descripcion: 'La evidencia disponible no es suficiente para un veredicto confiable.',
  },
};

const CATEGORIA_DESCONOCIDA = {
  etiqueta: 'Resultado no reconocido',
  color: '#9ca3af',
  descripcion: 'La respuesta recibida no coincide con ninguna categoría conocida.',
};

// Validación defensiva del lado del cliente: si el backend responde con un
// formato inesperado, se maneja sin romper la interfaz ni inventar datos.
function analisisEsValido(analisis) {
  if (!analisis || typeof analisis !== 'object') return false;
  if (typeof analisis.veredicto !== 'string') return false;
  if (typeof analisis.confianza !== 'number' || Number.isNaN(analisis.confianza)) return false;
  return true;
}

// Convierte cualquier forma de "detail" que devuelva el backend en un
// mensaje legible, para no mostrar "[object Object]" en las alertas.
function comoMensajeDeError(detail, mensajePorDefecto) {
  if (!detail) return mensajePorDefecto;
  if (typeof detail === 'string') return detail;
  if (Array.isArray(detail)) {
    const partes = detail
      .map((item) => (typeof item === 'string' ? item : item?.msg))
      .filter(Boolean);
    if (partes.length > 0) return partes.join(' | ');
  }
  try {
    return JSON.stringify(detail);
  } catch {
    return mensajePorDefecto;
  }
}

function comoListaDeTextos(valor) {
  if (!Array.isArray(valor)) return [];
  return valor.filter((item) => typeof item === 'string' && item.trim().length > 0);
}

// Indicador de veracidad (efecto "agua").
function IndicadorVeracidad({ porcentaje, color }) {
  const nivel = Math.max(0, Math.min(100, Number.isFinite(porcentaje) ? porcentaje : 0));
  return (
    <div className="indicador-veracidad" style={{ '--color-agua': color }}>
      <div className="indicador-veracidad__marco">
        <div className="indicador-veracidad__agua" style={{ height: `${nivel}%` }}>
          <div className="indicador-veracidad__ola" />
        </div>
        <span className="indicador-veracidad__valor">{Math.round(nivel)}%</span>
      </div>
      <span className="indicador-veracidad__etiqueta">Veracidad</span>
    </div>
  );
}

function App() {
  const { login, logout, wallet, isAuthenticated: isPollarAuthenticated } = usePollar();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [isLoggedInLocal, setIsLoggedInLocal] = useState(false);
  // "modo" es la pestaña activa: se elige arriba (TEXTO o IMAGEN) y decide
  // qué panel se muestra y qué se certifica. Ya no hace falta bloquear un
  // panel cuando el otro tiene contenido: solo uno está visible a la vez.
  const [modo, setModo] = useState('texto');
  const [textoAnalizar, setTexto] = useState('');
  const [resultado, setResultado] = useState(null);
  const [imagen, setImagen] = useState(null);
  const [cargando, setCargando] = useState(false);
  const [extrayendoArchivo, setExtrayendoArchivo] = useState(false);
  const [errorRespuesta, setErrorRespuesta] = useState(null);
  const inputArchivoImagenRef = useRef(null);
  const inputArchivoTextoRef = useRef(null);

  // Deja pasar si Pollar dice "true" o si el login local dice "true".
  const isAuthenticated = isPollarAuthenticated || isLoggedInLocal;

  const hayTexto = textoAnalizar.trim().length > 0;
  const hayImagen = Boolean(imagen);

  const cambiarModo = (nuevoModo) => {
    if (nuevoModo === modo || cargando) return;
    setModo(nuevoModo);
    setErrorRespuesta(null);
  };

  // --------------------------------------------------------------------
  // PERSISTENCIA DE SESIÓN LOCAL
  // La sesión se guarda en localStorage con una hora de expiración, así
  // que recargar la página NO cierra sesión. Solo se cierra sola cuando
  // pasa el tiempo de expiración (revisado periódicamente más abajo).
  // --------------------------------------------------------------------
  useEffect(() => {
    try {
      const guardada = localStorage.getItem(SESSION_STORAGE_KEY);
      if (!guardada) return;
      const { usuario, expiraEn } = JSON.parse(guardada);
      if (usuario && expiraEn && Date.now() < expiraEn) {
        setUsername(usuario);
        setIsLoggedInLocal(true);
      } else {
        localStorage.removeItem(SESSION_STORAGE_KEY);
      }
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY);
    }
  }, []);

  useEffect(() => {
    if (!isLoggedInLocal) return;
    const intervalo = setInterval(() => {
      try {
        const guardada = localStorage.getItem(SESSION_STORAGE_KEY);
        const expiraEn = guardada ? JSON.parse(guardada).expiraEn : 0;
        if (!guardada || Date.now() >= expiraEn) {
          localStorage.removeItem(SESSION_STORAGE_KEY);
          setIsLoggedInLocal(false);
          setUsername('');
          setPassword('');
        }
      } catch {
        localStorage.removeItem(SESSION_STORAGE_KEY);
        setIsLoggedInLocal(false);
      }
    }, SESSION_CHECK_INTERVAL_MS);
    return () => clearInterval(intervalo);
  }, [isLoggedInLocal]);

  const cargarImagenDesdeArchivo = (archivo) => {
    if (!archivo || !archivo.type.startsWith('image/')) {
      alert('Por favor, selecciona un archivo de imagen válido.');
      return;
    }
    const lector = new FileReader();
    lector.onload = (evento) => {
      setImagen(evento.target.result); // data URL: "data:image/xxx;base64,...."
    };
    lector.readAsDataURL(archivo);
  };

  const manejarDragOver = (e) => {
    e.preventDefault();
  };

  const manejarDrop = (e) => {
    e.preventDefault();
    cargarImagenDesdeArchivo(e.dataTransfer.files[0]);
  };

  const manejarSeleccionArchivo = (e) => {
    cargarImagenDesdeArchivo(e.target.files[0]);
  };

  // Extrae todo el texto seleccionable de un PDF, página por página, usando
  // pdfjs-dist (corre en el navegador, no requiere subir el archivo a ningún
  // lado). No funciona con PDFs escaneados sin capa de texto (imágenes puras).
  const extraerTextoDePDF = async (archivo) => {
    const arrayBuffer = await archivo.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const paginas = [];
    for (let numeroPagina = 1; numeroPagina <= pdf.numPages; numeroPagina++) {
      const pagina = await pdf.getPage(numeroPagina);
      const contenido = await pagina.getTextContent();
      paginas.push(contenido.items.map((item) => item.str).join(' '));
    }
    return paginas.join('\n\n');
  };

  // Permite cargar el texto a certificar desde un archivo (.txt, .md, .csv,
  // .json, .log o .pdf) en vez de escribirlo a mano. El texto extraído
  // reemplaza lo que haya en el cuadro de texto.
  const cargarTextoDesdeArchivo = async (archivo) => {
    if (!archivo) return;

    const nombre = archivo.name.toLowerCase();
    const esPDF = archivo.type === 'application/pdf' || nombre.endsWith('.pdf');
    const esTextoPlano = EXTENSIONES_TEXTO_PLANO.some((ext) => nombre.endsWith(ext));

    if (!esPDF && !esTextoPlano) {
      alert('Formato no soportado. Usa un archivo .txt, .md, .csv, .json, .log o .pdf.');
      return;
    }

    setExtrayendoArchivo(true);
    try {
      const textoExtraido = esPDF ? await extraerTextoDePDF(archivo) : await archivo.text();
      const textoLimpio = textoExtraido.trim();

      if (!textoLimpio) {
        alert('No se encontró texto en el archivo (si es un PDF escaneado sin texto seleccionable, no se puede extraer así).');
        return;
      }

      setTexto(textoLimpio);
    } catch (error) {
      console.error('Error al leer el archivo:', error);
      alert('No se pudo leer el archivo. Verifica que no esté dañado o protegido con contraseña.');
    } finally {
      setExtrayendoArchivo(false);
      if (inputArchivoTextoRef.current) inputArchivoTextoRef.current.value = '';
    }
  };

  const manejarSeleccionArchivoTexto = (e) => {
    cargarTextoDesdeArchivo(e.target.files[0]);
  };

  const quitarImagen = (e) => {
    e.stopPropagation();
    setImagen(null);
    if (inputArchivoImagenRef.current) inputArchivoImagenRef.current.value = '';
  };

  const manejarCambioTexto = (e) => {
    setTexto(e.target.value);
  };

  const handleLocalLogin = () => {
    if (username === 'usuario' && password === '1234') {
      const expiraEn = Date.now() + SESSION_DURATION_MS;
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify({ usuario: username, expiraEn }));
      setIsLoggedInLocal(true);
    } else {
      alert('Credenciales incorrectas.');
    }
  };

  const handleLogout = async () => {
    localStorage.removeItem(SESSION_STORAGE_KEY);
    setIsLoggedInLocal(false);
    setUsername('');
    setPassword('');
    if (isPollarAuthenticated) {
      await logout();
    }
  };

  // Llamada común al backend, usada tanto para texto como para imagen
  // (según la pestaña activa).
  const enviarACertificar = async ({ contenido, imagenBase64, imagenMimeType }) => {
    const direccionStellar = (isPollarAuthenticated && wallet) ? wallet.address : null;

    setCargando(true);
    setErrorRespuesta(null);

    try {
      const response = await fetch(`${API_URL}/api/certificar`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contenido,
          cuenta_stellar: direccionStellar,
          imagen_base64: imagenBase64,
          imagen_mime_type: imagenMimeType,
        })
      });

      const data = await response.json();

      if (!response.ok) {
        alert(`Error del servidor: ${comoMensajeDeError(data.detail, 'Fallo desconocido')}`);
        return;
      }

      if (!analisisEsValido(data.analisis)) {
        setErrorRespuesta('La IA devolvió una respuesta con un formato inesperado. Intenta de nuevo.');
        setResultado(null);
        return;
      }

      setResultado(data);
    } catch (error) {
      alert('No se pudo conectar con el servidor de IA. ¿Está encendido uvicorn?');
    } finally {
      setCargando(false);
    }
  };

  // Certifica según la pestaña activa ("modo"): solo se envía texto O
  // imagen, nunca ambos, sin importar qué quedó guardado en la otra pestaña.
  const certificar = async () => {
    if (modo === 'texto') {
      const textoLimpio = textoAnalizar.trim();
      if (!textoLimpio) {
        alert('Escribe o carga un texto para certificar.');
        return;
      }
      await enviarACertificar({ contenido: textoLimpio, imagenBase64: null, imagenMimeType: null });
      return;
    }

    if (!imagen) {
      alert('Suelta o selecciona una imagen para certificar.');
      return;
    }
    const coincidencia = /^data:([^;]+);base64,(.+)$/.exec(imagen);
    if (!coincidencia) {
      alert('No se pudo leer la imagen cargada. Intenta seleccionarla de nuevo.');
      return;
    }
    await enviarACertificar({ contenido: null, imagenBase64: coincidencia[2], imagenMimeType: coincidencia[1] });
  };

  // Pantalla de bloqueo: se muestra si no hay sesión activa.
  if (!isAuthenticated) {
    return (
      <div style={{ backgroundColor: '#05060E', minHeight: '100vh', width: '100vw', display: 'flex', justifyContent: 'center', alignItems: 'center', fontFamily: 'sans-serif', margin: '0' }}>

        <div style={{ backgroundColor: '#B14AED', borderRadius: '24px', padding: '40px 30px', width: '320px', textAlign: 'center', boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>

          <div style={{ backgroundColor: '#5B2A86', color: 'white', borderRadius: '12px', padding: '12px 25px', display: 'inline-flex', alignItems: 'center', gap: '8px', fontSize: '24px', fontWeight: 'bold', marginBottom: '22px' }}>
            METZTLI
            <span style={{ fontSize: '18px' }}>↖</span>
          </div>

          <h2 style={{ margin: '0 0 8px 0', color: '#05060E', fontSize: '22px', fontWeight: '700' }}>Bienvenido</h2>
          <p style={{ margin: '0 0 28px 0', color: '#3D1F5C', fontSize: '14px', lineHeight: '1.5' }}>
            Certifica la autenticidad de tu contenido con IA y Stellar.
          </p>

          <div style={{
            backgroundColor: 'rgba(5, 6, 14, 0.08)',
            borderRadius: '18px',
            padding: '26px 20px',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '14px'
          }}>
            <div style={{
              width: '52px',
              height: '52px',
              borderRadius: '50%',
              backgroundColor: '#05060E',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '24px'
            }}>
              🔐
            </div>

            <p style={{ margin: 0, color: '#05060E', fontSize: '13px', fontWeight: '600', letterSpacing: '0.3px' }}>
              Para empezar, inicia sesión con Pollar
            </p>

            <button
              onClick={async () => {
                try {
                  await login({ provider: 'google' });
                } catch (error) {
                  console.error('Error al iniciar sesión:', error);
                }
              }}
              style={{ width: '100%', padding: '14px', borderRadius: '12px', border: '2px solid #05060E', backgroundColor: '#000000', color: '#ffffff', fontWeight: 'bold', fontSize: '14px', cursor: 'pointer', transition: 'all 0.2s' }}
            >
              INICIAR SESIÓN CON POLLAR
            </button>

            <p style={{ margin: 0, color: '#3D1F5C', fontSize: '11px', lineHeight: '1.5' }}>
              Pollar es una smart wallet de Stellar: tu identidad queda ligada de forma nativa al mismo ecosistema donde se certifica tu contenido.
            </p>
          </div>

        </div>
      </div>
    );
  }

  // Aplicación principal (usuario ya autenticado).
  return (
    <div style={{ minHeight: '100vh', backgroundColor: '#12163A', fontFamily: 'sans-serif' }}>

      {/* Banner hero */}
      <div style={{
        backgroundColor: '#05060E',
        border: '6px solid #050505',
        minHeight: '90vh',
        padding: '40px 10%',
        display: 'flex',
        flexDirection: 'row',
        justifyContent: 'space-between',
        alignItems: 'center',
        flexWrap: 'wrap',
        gap: '200px',
      }}>

        {/* Lado izquierdo: textos */}
        <div style={{ flex: '1', minWidth: '300px' }}>
          <h1 style={{
            color: '#B14AED',
            fontSize: 'clamp(3rem, 8vw, 6rem)',
            fontWeight: '900',
            textTransform: 'uppercase',
            fontStyle: 'italic',
            margin: '0 0 20px 0',
            textShadow: '4px 4px 0px #5B2A86',
            letterSpacing: '-2px',
            lineHeight: '1'
          }}>
            BLOCKCHAIN & IA
          </h1>

          <div style={{ margin: '15px 0' }}>
            <span style={{ color: '#ffffff', backgroundColor: '#2E1A63', fontSize: '1.2rem', fontWeight: 'bold', padding: '8px 16px', letterSpacing: '2px', textTransform: 'uppercase' }}>
              Auditoría Criptográfica
            </span>
          </div>

          <p style={{ color: '#ffffff', fontSize: '1.2rem', maxWidth: '650px', marginTop: '15px', lineHeight: '1.6', fontWeight: '500' }}>
            Analiza el origen de textos e imágenes mediante modelos avanzados de lenguaje y asegura la evidencia de forma inmutable en la red Stellar.
          </p>
        </div>

        {/* Lado derecho: logo */}
        <div style={{ flex: '1', display: 'flex', justifyContent: 'center', minWidth: '300px' }}>
          <img
            src="logo.png"
            alt="Gráfico de Metztli"
            style={{
              maxWidth: '100%',
              maxHeight: '50vh',
              objectFit: 'contain',
            }}
          />
        </div>

      </div>

      {/* Contenedor de la aplicación */}
      <div style={{

        maxWidth: '1000px',
        width: '90%',
        margin: '50px auto',
        display: 'flex',
        flexDirection: 'column',
        gap: '40px'
      }}>

        {/* Sesión activa (usuario local o wallet Pollar) */}
        <div style={{ borderRadius: '30px', padding: '20px', backgroundColor: '#2E1A63' }}>
          <h2 style={{ color: '#B14AED', textTransform: 'uppercase', margin: '0 0 15px 0', fontSize: '24px', fontWeight: '900' }}>
            SESIÓN ACTIVA
          </h2>

          <div style={{ borderRadius: '30px', textAlign: 'center', color: '#ffffff', background: '#05060E', padding: '20px', border: '2px solid #05060E' }}>
            <p style={{ fontFamily: 'monospace', fontWeight: 'bold', fontSize: '18px' }}>
              CONECTADO: {
                isPollarAuthenticated && wallet && wallet.address
                  ? `${wallet.address.slice(0, 6)}...${wallet.address.slice(-4)}`
                  : isLoggedInLocal
                    ? username.toUpperCase()
                    : "Cargando credenciales..."
              }
            </p>
            <button
              onClick={handleLogout}
              style={{ borderRadius: '30px', width: '100%', padding: '15px', marginTop: '15px', backgroundColor: '#000000', color: '#ffffff', border: '2px solid #ffffff', fontWeight: 'bold', cursor: 'pointer', textTransform: 'uppercase' }}
            >
              DESCONECTAR
            </button>
          </div>
        </div>

        {/* Certificación: pestañas para elegir Texto o Imagen (solo una a la vez) */}
        <div style={{ borderRadius: '30px', padding: '20px', backgroundColor: '#2E1A63' }}>

          {/* Selector de pestaña */}
          <div style={{ display: 'flex', gap: '10px', marginBottom: '20px' }}>
            <button
              onClick={() => cambiarModo('texto')}
              disabled={cargando}
              style={{
                flex: 1,
                padding: '14px',
                borderRadius: '20px',
                border: 'none',
                backgroundColor: modo === 'texto' ? '#B14AED' : '#05060E',
                color: modo === 'texto' ? '#05060E' : '#ffffff',
                fontWeight: '900',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: cargando ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              Texto
            </button>
            <button
              onClick={() => cambiarModo('imagen')}
              disabled={cargando}
              style={{
                flex: 1,
                padding: '14px',
                borderRadius: '20px',
                border: 'none',
                backgroundColor: modo === 'imagen' ? '#B14AED' : '#05060E',
                color: modo === 'imagen' ? '#05060E' : '#ffffff',
                fontWeight: '900',
                textTransform: 'uppercase',
                letterSpacing: '1px',
                cursor: cargando ? 'not-allowed' : 'pointer',
                transition: 'all 0.2s ease'
              }}
            >
              Imagen
            </button>
          </div>

          {modo === 'texto' ? (
            <>
              <h2 style={{ color: '#B14AED', textTransform: 'uppercase', margin: '0 0 5px 0', fontSize: '24px', letterSpacing: '2px', fontWeight: '900' }}>
                INTRODUCIR TEXTO
              </h2>

              <p style={{ color: '#ffffff', fontSize: '14px', marginBottom: '15px', fontStyle: 'italic', lineHeight: '1.5' }}>
                Escribe el fragmento que deseas auditar o cárgalo desde un archivo (.txt, .md, .csv, .json, .log o .pdf). El motor de análisis evaluará los patrones semánticos para detectar su origen antes de sellar la evidencia de forma inmutable en la red Stellar.
              </p>

              <input
                ref={inputArchivoTextoRef}
                type="file"
                accept={ACCEPT_ARCHIVO_TEXTO}
                onChange={manejarSeleccionArchivoTexto}
                disabled={cargando || extrayendoArchivo}
                style={{ display: 'none' }}
              />
              <button
                onClick={() => inputArchivoTextoRef.current && inputArchivoTextoRef.current.click()}
                disabled={cargando || extrayendoArchivo}
                style={{
                  padding: '12px 20px',
                  borderRadius: '20px',
                  border: '2px dashed #ffffff',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  fontWeight: 'bold',
                  fontSize: '13px',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  cursor: (cargando || extrayendoArchivo) ? 'not-allowed' : 'pointer',
                  opacity: (cargando || extrayendoArchivo) ? 0.6 : 1,
                  marginBottom: '15px'
                }}
              >
                {extrayendoArchivo ? 'LEYENDO ARCHIVO...' : 'CARGAR DESDE ARCHIVO (.TXT / .MD / .PDF...)'}
              </button>

              <textarea
                placeholder="Ingresa el texto objetivo aquí, o cárgalo desde un archivo arriba..."
                rows={10}
                disabled={cargando || extrayendoArchivo}
                style={{
                  width: '100%',
                  padding: '15px',
                  fontSize: '16px',
                  border: '3px solid #050505',
                  borderRadius: '30px',
                  backgroundColor: (cargando || extrayendoArchivo) ? '#1a1a1a' : '#05060E',
                  color: (cargando || extrayendoArchivo) ? '#777777' : '#ffffff',
                  resize: 'vertical',
                  outline: 'none',
                  fontFamily: 'monospace',
                  boxSizing: 'border-box',
                  cursor: (cargando || extrayendoArchivo) ? 'not-allowed' : 'text'
                }}
                value={textoAnalizar}
                onChange={manejarCambioTexto}
              />

              <button
                onClick={certificar}
                disabled={cargando || extrayendoArchivo || !hayTexto}
                style={{
                  borderRadius: '30px',
                  width: '100%',
                  padding: '15px',
                  marginTop: '20px',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  border: '2px solid #555555',
                  textTransform: 'uppercase',
                  fontWeight: 'bold',
                  letterSpacing: '1px',
                  cursor: (cargando || extrayendoArchivo || !hayTexto) ? 'not-allowed' : 'pointer',
                  opacity: (cargando || extrayendoArchivo || !hayTexto) ? 0.6 : 1,
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => { if (!cargando && hayTexto) e.target.style.borderColor = '#ffffff'; }}
                onMouseOut={(e) => { if (!cargando && hayTexto) e.target.style.borderColor = '#555555'; }}
              >
                {cargando ? 'ANALIZANDO TEXTO...' : 'CERTIFICAR TEXTO'}
              </button>
            </>
          ) : (
            <>
              <h2 style={{ color: '#B14AED', textTransform: 'uppercase', margin: '0 0 5px 0', fontSize: '24px', fontWeight: '900' }}>
                EVIDENCIA VISUAL
              </h2>

              <p style={{ color: '#ffffff', fontSize: '14px', marginBottom: '15px', fontStyle: 'italic', lineHeight: '1.5' }}>
                Suelta o selecciona una imagen para auditarla.
              </p>

              <input
                ref={inputArchivoImagenRef}
                type="file"
                accept="image/*"
                onChange={manejarSeleccionArchivo}
                disabled={cargando}
                style={{ display: 'none' }}
              />
              <div
                onDrop={cargando ? undefined : manejarDrop}
                onDragOver={cargando ? undefined : manejarDragOver}
                onClick={() => { if (!cargando && inputArchivoImagenRef.current) inputArchivoImagenRef.current.click(); }}
                style={{
                  borderRadius: '30px',
                  width: '100%',
                  padding: imagen ? '10px' : '60px 20px',
                  border: '2px dashed #ffffff',
                  textAlign: 'center',
                  boxSizing: 'border-box',
                  cursor: cargando ? 'not-allowed' : 'pointer',
                  backgroundColor: '#000000',
                  opacity: (cargando && !imagen) ? 0.5 : 1,
                  position: 'relative'
                }}
              >
                {imagen ? (
                  <>
                    <img src={imagen} alt="Vista previa" style={{ maxWidth: '100%', maxHeight: '400px', objectFit: 'contain' }} />
                    <button
                      onClick={quitarImagen}
                      style={{
                        marginTop: '10px',
                        padding: '10px 20px',
                        borderRadius: '30px',
                        border: '2px solid #f87171',
                        backgroundColor: 'transparent',
                        color: '#f87171',
                        fontWeight: 'bold',
                        cursor: 'pointer',
                        textTransform: 'uppercase'
                      }}
                    >
                      Quitar imagen
                    </button>
                  </>
                ) : (
                  <p style={{ color: '#ffffff', fontWeight: 'bold', fontSize: '18px', margin: 0 }}>
                    SUELTA TU IMAGEN AQUÍ O HAZ CLIC PARA SELECCIONARLA
                  </p>
                )}
              </div>

              <button
                onClick={certificar}
                disabled={cargando || !hayImagen}
                style={{
                  borderRadius: '30px',
                  width: '100%',
                  padding: '15px',
                  marginTop: '20px',
                  backgroundColor: '#000000',
                  color: '#ffffff',
                  border: '2px solid #555555',
                  textTransform: 'uppercase',
                  fontWeight: 'bold',
                  letterSpacing: '1px',
                  cursor: (cargando || !hayImagen) ? 'not-allowed' : 'pointer',
                  opacity: (cargando || !hayImagen) ? 0.6 : 1,
                  transition: 'all 0.3s ease'
                }}
                onMouseOver={(e) => { if (!cargando && hayImagen) e.target.style.borderColor = '#ffffff'; }}
                onMouseOut={(e) => { if (!cargando && hayImagen) e.target.style.borderColor = '#555555'; }}
              >
                {cargando ? 'ANALIZANDO IMAGEN...' : 'CERTIFICAR IMAGEN'}
              </button>
            </>
          )}

          <div style={{
            marginTop: '20px',
            paddingTop: '15px',
            borderTop: '2px dashed #050505',
            display: 'flex',
            flexDirection: 'column',
            gap: '10px'
          }}>
            <span style={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>
              CATEGORÍAS POSIBLES DEL ANÁLISIS:
            </span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '14px', color: '#ffffff', fontSize: '13px' }}>
              {Object.values(CATEGORIAS).map((cat) => (
                <span key={cat.etiqueta}>
                  <b style={{ color: cat.color }}>●</b> {cat.etiqueta}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Error de formato en la respuesta de la IA */}
        {errorRespuesta && (
          <div style={{ border: '2px solid #f87171', borderRadius: '30px', padding: '20px', backgroundColor: '#0a0a0a', color: '#f87171', fontWeight: 'bold' }}>
            {errorRespuesta}
          </div>
        )}

        {/* Resultado del análisis */}
        {resultado && (() => {
          const analisis = resultado.analisis;
          const categoria = CATEGORIAS[analisis.veredicto] || CATEGORIA_DESCONOCIDA;
          const razones = comoListaDeTextos(analisis.razones);
          const evidencia = comoListaDeTextos(analisis.evidencia_observada);
          const indicadores = comoListaDeTextos(analisis.indicadores_detectados);

          return (
            <div style={{ border: `2px solid ${categoria.color}`, borderRadius: '30px', padding: '20px', backgroundColor: '#0a0a0a' }}>
              <h2 style={{ color: categoria.color, textTransform: 'uppercase', margin: '0 0 15px 0', fontSize: '24px', fontWeight: '900' }}>
                VEREDICTO OBTENIDO
              </h2>

              <div style={{ borderRadius: '30px', background: '#000', color: '#fff', padding: '20px', border: `1px solid ${categoria.color}`, display: 'flex', flexWrap: 'wrap', gap: '30px' }}>

                {/* Detalle del veredicto */}
                <div style={{ flex: '2', minWidth: '260px' }}>
                  <h2 style={{ margin: '0 0 6px 0', color: categoria.color, textTransform: 'uppercase', fontSize: '30px', letterSpacing: '2px' }}>
                    {categoria.etiqueta}
                  </h2>
                  <p style={{ color: '#cccccc', fontSize: '14px', marginBottom: '14px' }}>{categoria.descripcion}</p>

                  {analisis.nivel_incertidumbre && (
                    <p style={{ fontFamily: 'monospace', fontSize: '13px', color: '#9ca3af', marginBottom: '14px' }}>
                      NIVEL DE INCERTIDUMBRE: <strong style={{ color: '#fff' }}>{String(analisis.nivel_incertidumbre).toUpperCase()}</strong>
                    </p>
                  )}

                  {razones.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <span style={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>RAZONES</span>
                      <ul style={{ textAlign: 'left', paddingLeft: '20px', marginTop: '6px', lineHeight: '1.6', fontSize: '15px' }}>
                        {razones.map((razon, index) => (
                          <li key={index} style={{ marginBottom: '4px' }}>{razon}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {evidencia.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <span style={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>EVIDENCIA OBSERVADA</span>
                      <ul style={{ textAlign: 'left', paddingLeft: '20px', marginTop: '6px', lineHeight: '1.6', fontSize: '15px', color: '#cccccc' }}>
                        {evidencia.map((item, index) => (
                          <li key={index} style={{ marginBottom: '4px' }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {indicadores.length > 0 && (
                    <div style={{ marginBottom: '14px' }}>
                      <span style={{ color: '#ffffff', fontSize: '12px', fontWeight: 'bold', letterSpacing: '1px' }}>INDICADORES DETECTADOS</span>
                      <ul style={{ textAlign: 'left', paddingLeft: '20px', marginTop: '6px', lineHeight: '1.6', fontSize: '15px', color: '#cccccc' }}>
                        {indicadores.map((item, index) => (
                          <li key={index} style={{ marginBottom: '4px' }}>{item}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {typeof analisis.explicacion === 'string' && analisis.explicacion.trim() && (
                    <p style={{ fontSize: '14px', color: '#cccccc', fontStyle: 'italic', marginTop: '10px', lineHeight: '1.5' }}>
                      {analisis.explicacion}
                    </p>
                  )}
                </div>

                {/* Indicador de veracidad */}
                <div style={{ flex: '1', minWidth: '160px', display: 'flex', justifyContent: 'center', alignItems: 'flex-start' }}>
                  <IndicadorVeracidad porcentaje={analisis.confianza} color={categoria.color} />
                </div>
              </div>

              <a
                href={resultado.stellar.url_explorador}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  borderRadius: '30px',
                  color: '#000',
                  backgroundColor: categoria.color,
                  textDecoration: 'none',
                  display: 'block',
                  marginTop: '25px',
                  padding: '15px',
                  fontWeight: 'bold',
                  textAlign: 'center',
                  textTransform: 'uppercase',
                  letterSpacing: '1px',
                  transition: 'opacity 0.2s ease'
                }}
                onMouseOver={(e) => e.target.style.opacity = '0.8'}
                onMouseOut={(e) => e.target.style.opacity = '1'}
              >
                VER REGISTRO INMUTABLE EN STELLAR
              </a>
            </div>
          );
        })()}

      </div>
    </div>
  );
}

export default App;
