# Metztli

## ¿Qué es esto?

Metztli certifica la autenticidad de un contenido (texto o imagen): una IA lo
analiza y determina si parece auténtico, generado por IA, manipulado, o si no
hay evidencia suficiente para concluir. Cada resultado queda sellado de forma
pública e inmutable en la blockchain de Stellar, con fecha y hora, para que
cualquiera pueda verificarlo de forma independiente, sin tener que confiar
únicamente en la palabra de la plataforma.

El inicio de sesión se hace con **Pollar**, una smart wallet de Stellar —
así que la identidad del usuario también vive de forma nativa en el mismo
ecosistema donde se certifica el contenido, en vez de depender de un sistema
de cuentas tradicional y separado.

## Cuenta pública en Stellar (verificable)

Todos los certificados que emite Metztli salen de esta misma cuenta, en la
red de pruebas (testnet) de Stellar:

```
GDGZ4FK5XQ23YNS7BEYGBLPZZTSP5MQ5BDKBIOYWDTV4TUT6L7C34KYU
```

Puedes ver su historial de transacciones en vivo, sin necesidad de confiar en
nuestra palabra, aquí:

https://stellar.expert/explorer/testnet/account/GDGZ4FK5XQ23YNS7BEYGBLPZZTSP5MQ5BDKBIOYWDTV4TUT6L7C34KYU

## Para quién es

Pensado para profesores, abogados y empresas que necesitan verificar
contenido con evidencia que puedan mostrar y defender, no solo un resultado
que aparece en una pantalla y ya: un profesor que revisa si una tarea fue
escrita por el alumno, un abogado que necesita probar que un documento o
imagen no fue alterado, una empresa que valida contenido antes de publicarlo.

**¿Por qué Stellar específicamente, y no cualquier blockchain?** Tres
razones que la tarea exige:

- **Identidad pública y fija**: todos los certificados salen de la misma
  cuenta conocida de Metztli, así que cualquiera puede confirmar que un
  certificado realmente viene de la plataforma y no fue inventado.
- **Costo casi nulo por transacción**: verificar contenido en volumen (varias
  tareas, varios documentos) no es viable si cada verificación cuesta caro.
- **Confirmación en segundos**: la evidencia queda registrada de forma
  pública casi al instante, no hay que esperar minutos u horas.

## Impacto

- **Comunidad UNAM**: ayuda a detectar contenido académico generado por IA
  de forma verificable y auditable, no solo con un "confía en mí".
- **Profesionales de LatAm** (abogados, empresas, medios): una forma
  accesible de verificar autenticidad sin depender de herramientas
  propietarias costosas.

El resultado concreto es visible en cada certificación: un veredicto
estructurado (con su nivel de confianza y evidencia) más un registro público
en Stellar que cualquier persona, no solo el equipo de Metztli, puede abrir y
confirmar por su cuenta.

## Desarrollo asistido por IA

Este proyecto fue construido con asistencia de IA (Claude, de Anthropic)
como herramienta de desarrollo durante el hackathon: para escribir y depurar
partes del código del backend, reforzar el prompt de análisis y su defensa
contra prompt injection, y resolver errores de integración con Stellar y
Gemini. El diseño del producto, las decisiones de arquitectura y la
implementación final son del equipo.

---

## Nota: llaves propias (solo si vas a correr el proyecto en tu compu)

> **¿Solo quieres probarlo?** Usa la app en vivo: https://metztli-8p1z.vercel.app. No necesitas ninguna llave.

Si clonas el repositorio para correrlo localmente, necesitas tus **propias llaves**.
Las del equipo no están en el código y nunca se suben a GitHub (`.env` está en `.gitignore`).

| Llave | Para qué sirve | Dónde se obtiene |
|---|---|---|
| `GEMINI_API_KEY` | Análisis de autenticidad con IA (Google Gemini) | Gratis en https://aistudio.google.com/app/apikey |
| `STELLAR_SECRET_KEY` | Cuenta de Stellar **testnet** que firma y paga las transacciones de los certificados | Se genera con `python generar_cuenta_stellar.py` (ver paso 3). También puedes usar la tuya: `python generar_cuenta_stellar.py --secret S...` |
| Pollar (login) | Inicio de sesión con smart wallet | Ya viene incluida en el frontend (llave pública de testnet). No tienes que configurar nada |

**Sobre la llave de Stellar:**
- Stellar no usa "API keys": tu cuenta es un par de llaves. La **pública** (`G...`) se puede compartir; la **secreta** (`S...`) es la que va en `.env` y nunca se comparte.
- Es red de **pruebas**, no maneja dinero real. Si prefieres hacerlo a mano, entra a https://lab.stellar.org, ve a *Account → Create Account Keypair*, genera el par y pulsa *Fund account with Friendbot*.
- La testnet se reinicia periódicamente. Si un día deja de funcionar, vuelve a correr `python generar_cuenta_stellar.py --force`.
- Los certificados que hagas en tu instalación saldrán de **tu** cuenta, no de la de Metztli, y los verás en `https://stellar.expert/explorer/testnet/account/TU_LLAVE_PUBLICA`.

## Pasos para Ejecutar el Proyecto

1- Clonar el repositorio

```
git clone https://github.com/jimenezfabricio470-alt/Metztli..git
cd Metztli
```

2- Configurar el Backend

```
cd backend/app
pip install -r requirements.txt
```

3- Configurar las variables de entorno. Busca el archivo `.env.example`
(está en `backend/`, un nivel arriba de `backend/app`), duplícalo y
renómbralo a exactamente `.env`. Ábrelo y pega tu clave de Gemini
(se obtiene gratis en https://aistudio.google.com/app/apikey):

```
GEMINI_API_KEY="tu_api_key_de_gemini"
```

Luego genera tu cuenta de Stellar de pruebas. Este comando la crea, la fondea
con XLM de prueba y escribe `STELLAR_SECRET_KEY` en tu `.env` automáticamente:

```
cd ..
python generar_cuenta_stellar.py
cd app
```

4- Iniciar el Servidor Backend

```
python -m uvicorn main:app --reload
```

5- Configurar e Iniciar el Frontend (React)

```
cd frontend
npm install
```

Configura la URL del backend: busca el archivo `frontend/.env.example`,
duplícalo y renómbralo a exactamente `.env`. Ese archivo ya trae:

```
VITE_API_URL=http://localhost:8000
```

que es la dirección donde corre tu backend local (paso 4). Para producción se
usa automáticamente `frontend/.env.production`, que apunta al backend de
Render.

6- Inicia el entorno de desarrollo visual.

```
npm run dev
```

Si cambias el valor de `VITE_API_URL`, debes reiniciar `npm run dev` (Vite
solo lee las variables de entorno al arrancar).

7- Abre tu navegador y entra a http://localhost:5173
