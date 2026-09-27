Pasos para Ejecutar el Proyecto.

1- Clonar el repositorio

git clone <https://github.com/jimenezfabricio470-alt/Metztli.git>
cd proyecto-metztli

2- Configurar el Backend

cd backend/app


pip install -r requirements.txt

3- Configurar las Variables de entorno.Busca el archivo llamado .env.example, duplícalo y renómbralo a exactamente .env. Abre ese nuevo archivo .env y pega tus propias claves:

GEMINI_API_KEY: 

4- Iniciar el Servidor Backend

python -m uvicorn main:app --reload

5- Configurar e Iniciar el Frontend (React)

cd frontend

npm install

Configura la URL del backend: busca el archivo frontend/.env.example, duplícalo
y renómbralo a exactamente .env. Ese archivo ya trae:

VITE_API_URL=http://localhost:8000

que es la dirección donde corre tu backend local (paso 4). Para producción se
usa automáticamente frontend/.env.production, que apunta al backend de Render.

6- Inicia el entorno de desarrollo visual.

npm run dev

Si cambias el valor de VITE_API_URL, debes reiniciar "npm run dev" (Vite solo
lee las variables de entorno al arrancar).

7- Abre tu navegador y entra a http://localhost:5173
