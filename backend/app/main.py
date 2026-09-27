import base64
from concurrent.futures import ThreadPoolExecutor
from typing import Optional

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, field_validator

from services.gemini_ai import analizar_documento, MAX_IMAGEN_BYTES, MIME_TYPES_IMAGEN_PERMITIDOS
from services.stellar import registrar_hash_en_stellar

app = FastAPI(title="API Proyecto Metztli")


# Por defecto, cuando un dato enviado no cumple el esquema (por ejemplo,
# una imagen demasiado grande o un campo con el tipo equivocado), FastAPI
# devuelve "detail" como una LISTA de objetos, no como texto. Eso hace que
# el frontend, al intentar mostrarlo con un simple `${data.detail}`, imprima
# "[object Object]" en vez de un mensaje entendible. Este manejador convierte
# siempre "detail" en un texto legible en español.
@app.exception_handler(RequestValidationError)
async def manejar_error_de_validacion(request: Request, exc: RequestValidationError):
    mensajes = []
    for error in exc.errors():
        campo = ".".join(str(parte) for parte in error.get("loc", []) if parte != "body")
        mensaje = error.get("msg", "Dato inválido.")
        mensajes.append(f"{campo}: {mensaje}" if campo else mensaje)
    return JSONResponse(
        status_code=422,
        content={"detail": " | ".join(mensajes) or "Los datos enviados no son válidos."},
    )

# OJO: los orígenes van SIN "/" al final, si no, el navegador los rechaza
# aunque se vean "iguales". Agregamos también localhost para poder
# probar en su compu con npm run dev.
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "https://metztli-h3ixu341e-jimenezfabricio470-alt.vercel.app",
        "http://localhost:5173","https://metztli-gamma.vercel.app/",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


class Documento(BaseModel):
    # Se certifica solo texto O solo imagen, nunca ambos. Se valida más
    # abajo que llegue exactamente uno de los dos.
    contenido: Optional[str] = None
    cuenta_stellar: Optional[str] = None
    # Imagen en base64 puro (sin el prefijo "data:image/...;base64,"), y su
    # mime type declarado por separado.
    imagen_base64: Optional[str] = None
    imagen_mime_type: Optional[str] = None

    @field_validator("contenido")
    @classmethod
    def limitar_contenido(cls, v):
        if v is not None and len(v) > 200_000:
            raise ValueError("El texto supera el largo máximo permitido.")
        return v

    @field_validator("imagen_base64")
    @classmethod
    def limitar_imagen(cls, v):
        # Validación temprana de tamaño aproximado en base64 (~4/3 del
        # tamaño real en bytes) para rechazar payloads absurdos sin decodificar.
        if v is not None and len(v) > int(MAX_IMAGEN_BYTES * 4 / 3) + 1024:
            raise ValueError("La imagen supera el tamaño máximo permitido.")
        return v


@app.get("/")
def inicio(request: Request):
    # La URL de "docs" se construye a partir de la petición entrante en vez
    # de estar hardcodeada, así funciona igual en local (localhost:8000) y
    # en producción (Render) sin tocar el código.
    return {
        "status": "online",
        "app": "Metztli API",
        "docs": f"{str(request.base_url).rstrip('/')}/docs"
    }


@app.post("/api/certificar")
def certificar_texto(doc: Documento):
    contenido = (doc.contenido or "").strip() or None
    imagen_base64 = doc.imagen_base64 or None

    if not contenido and not imagen_base64:
        raise HTTPException(
            status_code=400,
            detail="Debes incluir texto o una imagen."
        )

    # Regla de exclusión mutua: solo se certifica texto O imagen, nunca
    # ambos al mismo tiempo, sin importar lo que el frontend haya validado.
    if contenido and imagen_base64:
        raise HTTPException(
            status_code=400,
            detail="No se puede certificar texto e imagen al mismo tiempo. Envía solo uno de los dos."
        )

    if imagen_base64 and (doc.imagen_mime_type or "").lower() not in MIME_TYPES_IMAGEN_PERMITIDOS:
        raise HTTPException(
            status_code=400,
            detail="Tipo de imagen no soportado. Usa PNG, JPEG, WEBP o HEIC/HEIF."
        )

    try:
        imagen_bytes = base64.b64decode(imagen_base64) if imagen_base64 else None

        # El veredicto de la IA y el sellado en Stellar son independientes
        # entre sí (Stellar solo necesita el hash del contenido, no el
        # veredicto), así que se lanzan en paralelo en vez de uno tras
        # otro. Esto reduce el tiempo total de espera casi a la mitad.
        with ThreadPoolExecutor(max_workers=2) as executor:
            tarea_ia = executor.submit(
                analizar_documento,
                texto=contenido,
                imagen_base64=imagen_base64,
                imagen_mime_type=doc.imagen_mime_type,
            )
            tarea_stellar = executor.submit(
                registrar_hash_en_stellar,
                texto=contenido,
                cuenta_usuario=doc.cuenta_stellar,
                imagen_bytes=imagen_bytes,
            )

            # El análisis de la IA ya viene validado contra un esquema
            # estricto (ver services/gemini_ai.py): el backend nunca reenvía
            # al frontend una respuesta con campos faltantes, tipos
            # incorrectos o un veredicto fuera de las categorías conocidas.
            veredicto_ia = tarea_ia.result()
            hash_transaccion = tarea_stellar.result()

        return {
            "exito": True,
            "analisis": veredicto_ia,
            "stellar": {
                "hash": hash_transaccion,
                "url_explorador": f"https://stellar.expert/explorer/testnet/tx/{hash_transaccion}"
            }
        }
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
