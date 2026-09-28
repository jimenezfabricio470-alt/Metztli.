"""
generar_cuenta_stellar.py

Crea (o reutiliza) la cuenta de Stellar TESTNET desde la que Metztli emite sus
certificados, la fondea con Friendbot (XLM de prueba gratis) y guarda la llave
secreta en backend/.env como STELLAR_SECRET_KEY.

Uso (desde la carpeta backend/):

    python generar_cuenta_stellar.py                 # genera una cuenta nueva
    python generar_cuenta_stellar.py --secret S...   # usa TU propia llave
    python generar_cuenta_stellar.py --force         # sobrescribe la llave que ya haya en .env

Nota: Stellar no usa "API keys". La identidad es un par de llaves: la pública
(empieza con G, se puede compartir) y la secreta (empieza con S, NUNCA se sube
a GitHub). El archivo .env ya está en .gitignore.
"""
import argparse
import sys
from pathlib import Path

import requests
from stellar_sdk import Keypair

CARPETA_BACKEND = Path(__file__).resolve().parent
RUTA_ENV = CARPETA_BACKEND / ".env"
RUTA_ENV_EJEMPLO = CARPETA_BACKEND / ".env.example"

VARIABLE = "STELLAR_SECRET_KEY"
FRIENDBOT_URL = "https://friendbot.stellar.org"
EXPLORADOR = "https://stellar.expert/explorer/testnet/account/"


def _leer_lineas_env():
    """Lee backend/.env; si no existe, parte de .env.example (si existe)."""
    if RUTA_ENV.exists():
        return RUTA_ENV.read_text(encoding="utf-8").splitlines()
    if RUTA_ENV_EJEMPLO.exists():
        return RUTA_ENV_EJEMPLO.read_text(encoding="utf-8").splitlines()
    return []


def _llave_actual(lineas):
    """Devuelve la llave ya configurada, o None si falta o es el placeholder."""
    for linea in lineas:
        if linea.strip().startswith(f"{VARIABLE}="):
            valor = linea.split("=", 1)[1].strip().strip('"').strip("'")
            if valor.startswith("S") and "pega_tu" not in valor:
                return valor
    return None


def _guardar_en_env(lineas, secreto):
    nueva = f'{VARIABLE}="{secreto}"'
    reemplazada = False
    resultado = []
    for linea in lineas:
        if linea.strip().startswith(f"{VARIABLE}="):
            resultado.append(nueva)
            reemplazada = True
        else:
            resultado.append(linea)
    if not reemplazada:
        resultado.append(nueva)
    RUTA_ENV.write_text("\n".join(resultado) + "\n", encoding="utf-8")


def _fondear_con_friendbot(llave_publica):
    """Pide XLM de prueba. Sin fondos la cuenta no existe en la red y las
    transacciones fallan."""
    try:
        r = requests.get(FRIENDBOT_URL, params={"addr": llave_publica}, timeout=60)
    except requests.RequestException as error:
        print(f"No se pudo contactar a Friendbot: {error}")
        return False

    if r.status_code == 200:
        return True
    # Friendbot responde 400 si la cuenta ya estaba fondeada: no es un problema.
    if r.status_code == 400 and "already funded" in r.text.lower():
        print("La cuenta ya estaba fondeada.")
        return True
    print(f"Friendbot respondió {r.status_code}: {r.text[:200]}")
    return False


def main():
    parser = argparse.ArgumentParser(description="Configura la cuenta de Stellar testnet de Metztli.")
    parser.add_argument("--secret", help="Usar tu propia llave secreta (S...) en vez de generar una nueva.")
    parser.add_argument("--force", action="store_true", help="Sobrescribir la llave que ya esté en .env.")
    args = parser.parse_args()

    lineas = _leer_lineas_env()
    existente = _llave_actual(lineas)

    if existente and not args.force and not args.secret:
        keypair = Keypair.from_secret(existente)
        print(f"Ya hay una llave configurada en .env. Cuenta pública: {keypair.public_key}")
        print("Verificando que esté fondeada...")
        if _fondear_con_friendbot(keypair.public_key):
            print(f"Listo. Historial: {EXPLORADOR}{keypair.public_key}")
        else:
            print("No se pudo confirmar el fondeo. Puedes hacerlo a mano en https://lab.stellar.org (Account → Fund Account, red Testnet).")
        print("(Usa --force para reemplazarla por una nueva.)")
        return

    if args.secret:
        try:
            keypair = Keypair.from_secret(args.secret.strip())
        except Exception:
            print("Esa llave secreta no es válida (debe empezar con S y tener 56 caracteres).")
            sys.exit(1)
    else:
        keypair = Keypair.random()

    print(f"Cuenta pública: {keypair.public_key}")
    print("Fondeando con Friendbot (testnet)...")
    fondeada = _fondear_con_friendbot(keypair.public_key)

    _guardar_en_env(lineas, keypair.secret)
    print(f"Llave secreta guardada en {RUTA_ENV}")

    if not fondeada:
        print(
            "\nOJO: no se pudo fondear automáticamente. Hazlo a mano pegando la cuenta pública en\n"
            "https://lab.stellar.org (Account → Fund Account, red Testnet) y luego arranca el backend."
        )
    else:
        print(f"\nListo. Puedes ver la cuenta aquí: {EXPLORADOR}{keypair.public_key}")
    print("Recuerda: la llave secreta (S...) nunca se sube a GitHub. .env ya está en .gitignore.")


if __name__ == "__main__":
    main()
