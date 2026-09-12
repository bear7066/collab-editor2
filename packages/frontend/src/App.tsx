import React from 'react';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { Dashboard } from './components/Dashboard';
import { EditorContainer } from './components/EditorContainer';
import { Board } from './components/Board';
import { AuthGate } from './components/auth/AuthGate';

export const App: React.FC = () => {
  return (
    <AuthGate>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/board/:boardName" element={<Board />} />
          <Route path="/project/:projectName" element={<EditorContainer />} />
          <Route path="*" element={<Dashboard />} />
        </Routes>
      </BrowserRouter>
    </AuthGate>
  );
};

export default App;
