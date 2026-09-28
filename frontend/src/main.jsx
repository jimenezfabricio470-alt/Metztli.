import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './App.css';
import { PollarProvider } from '@pollar/react';

// 1. Agrupamos las credenciales en un objeto
const configuracionCliente = {
  apiKey: "pub_testnet_38ae6784c0c19a378d5e58487e702d98",
  network: "testnet"
};

ReactDOM.createRoot(document.getElementById('root')).render(
  // 2. Inyectamos el objeto en la propiedad 'client' que espera la librería
  <PollarProvider client={configuracionCliente}>
    <App />
  </PollarProvider>
);
