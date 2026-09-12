import React from 'react';
import { BrowserRouter, Navigate, Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { Board } from './components/Board';
import { AuthGate } from './components/auth/AuthGate';

export const App: React.FC = () => {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/board/:boardName" element={<Board />} />
          {/* Markdown projects were folded into boards; old links land on the dashboard. */}
          <Route path="/project/*" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
};

export default App;
