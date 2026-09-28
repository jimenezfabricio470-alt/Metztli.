import hashlib
import os
import requests
from dotenv import load_dotenv
from stellar_sdk import Keypair, Server, TransactionBuilder, Network, HashMemo, Asset
from stellar_sdk.exceptions import NotFoundError

load_dotenv()

# Antes esto era Keypair.random() -> generaba una cuenta NUEVA cada
# vez que el servidor arrancaba. Ahora cargamos SIEMPRE la misma,
# guardada en STELLAR_SECRET_KEY (generada una vez con
# generar_cuenta_stellar.py).
secreto = (os.getenv("STELLAR_SECRET_KEY") or "").strip().strip('"').strip("'")
if not secreto or "pega_tu" in secreto:
    raise ValueError(
        "Falta configurar STELLAR_SECRET_KEY en backend/.env. "
        "Desde la carpeta backend/ corre `python generar_cuenta_stellar.py` "
        "(crea y fondea una cuenta de testnet) o pega tu propia llave secreta (S...)."
    )

try:
    keypair = Keypair.from_secret(secreto)
except Exception:
    raise ValueError(
        "STELLAR_SECRET_KEY no es una llave secreta válida de Stellar "
        "(debe empezar con S y tener 56 caracteres)."
    )

server = Server("https://horizon-testnet.stellar.org")


def _calcular_huella(texto=None, imagen_bytes=None):
    """Calcula un hash SHA-256 combinando texto e imagen cuando ambos están
    presentes, para que la evidencia sellada en Stellar corresponda
    exactamente a lo que se analizó."""
    hasher = hashlib.sha256()
    aporto_algo = False

    if texto:
        hasher.update(texto.encode("utf-8"))
        aporto_algo = True

    if imagen_bytes:
        hasher.update(imagen_bytes)
        aporto_algo = True

    if not aporto_algo:
        raise ValueError("No hay texto ni imagen para calcular la huella.")

    return hasher.digest()


def registrar_hash_en_stellar(texto=None, cuenta_usuario=None, imagen_bytes=None):
    # 1. Hashear el contenido (texto y/o imagen)
    huella = _calcular_huella(texto=texto, imagen_bytes=imagen_bytes)

    # 2. Cargar la cuenta del servidor como origen (tiene la llave para firmar y pagar el fee)
    try:
        source_account = server.load_account(keypair.public_key)
    except NotFoundError:
        raise RuntimeError(
            f"La cuenta {keypair.public_key} no existe en testnet (no está fondeada). "
            "Fondéala con `python generar_cuenta_stellar.py` o en "
            "https://lab.stellar.org (Account → Fund Account, red Testnet)."
        )

    # 3. Decidir a quién va dirigida la evidencia
    if cuenta_usuario:
        print(f"Vinculando evidencia a la wallet de Pollar: {cuenta_usuario}")
        destino = cuenta_usuario
    else:
        print("Login local detectado. Guardando evidencia en la bóveda interna...")
        destino = keypair.public_key  # se lo envía a sí mismo

    # 4. Construir la transacción
    transaction = (
        TransactionBuilder(
            source_account=source_account,
            network_passphrase=Network.TESTNET_NETWORK_PASSPHRASE,
            base_fee=100,
        )
        .add_memo(HashMemo(huella))
        .append_payment_op(
            destination=destino,
            asset=Asset.native(),
            amount="0.0000001"
        )
        .set_timeout(30)
        .build()
    )

    # 5. Firmar y enviar
    transaction.sign(keypair)
    response = server.submit_transaction(transaction)

    return response['hash']
