import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import App from './App.jsx';
import WaitingList from './pages/WaitingList.jsx';
import FinalList from './pages/FinalList.jsx';
import PostDetail from './pages/PostDetail.jsx';
import AddRepo from './pages/AddRepo.jsx';
import './styles.css';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <BrowserRouter>
      <App>
        <Routes>
          <Route path="/" element={<WaitingList />} />
          <Route path="/final" element={<FinalList />} />
          <Route path="/post/:id" element={<PostDetail />} />
          <Route path="/add" element={<AddRepo />} />
        </Routes>
      </App>
    </BrowserRouter>
  </React.StrictMode>,
);