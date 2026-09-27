import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';
import { PollarProvider } from '@pollar/react';

// 1. Agrupamos las credenciales en un objeto
const configuracionCliente = {
  apiKey: "pub_testnet_cf35b95744c6a761874521c1a3c3b99a",
  network: "testnet"
};

ReactDOM.createRoot(document.getElementById('root')).render(
  // 2. Inyectamos el objeto en la propiedad 'client' que espera la librería
  <PollarProvider client={configuracionCliente}>
    <App />
  </PollarProvider>
);
