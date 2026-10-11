import { createRoot } from 'react-dom/client';
import './style.css';
import { useEffect, useState } from 'react';
import { Brand, Spinner, Button, Message } from './components/ui';
import { Login } from './pages/Login';
import { Workspace } from './pages/Workspace';
import { api, ApiError, errorMessage } from './api';
import { clearIconCatalogCache } from './icon-cache';

function App() {
  const [state, setState] = useState<{ configured: boolean; initialized: boolean; loggedIn: boolean } | null>(
    null,
  );
  const [error, setError] = useState('');
  async function start() {
    setError('');
    try {
      const status = await api<{ configured: boolean; initialized: boolean }>('/api/status');
      let loggedIn = false;
      if (status.initialized) {
        try {
          await api('/api/me');
          loggedIn = true;
        } catch (error) {
          if (!(error instanceof ApiError) || error.status !== 401) throw error;
        }
      }
      setState({ ...status, loggedIn });
    } catch (error) {
      setError(errorMessage(error));
    }
  }
  useEffect(() => {
    void start();
    const expired = () => {
      clearIconCatalogCache();
      setState((previous) => (previous ? { ...previous, loggedIn: false } : null));
    };
    window.addEventListener('libra:expired', expired);
    return () => window.removeEventListener('libra:expired', expired);
  }, []);
  if (!state)
    return (
      <div className="boot-screen">
        <Brand />
        {error ? (
          <>
            <Message tone="error">{error}</Message>
            <Button onClick={() => void start()}>重试</Button>
          </>
        ) : (
          <Spinner />
        )}
      </div>
    );
  return state.loggedIn ? (
    <Workspace
      logout={() => {
        clearIconCatalogCache();
        setState({ ...state, loggedIn: false });
      }}
    />
  ) : (
    <Login
      initialized={state.initialized}
      configured={state.configured}
      onLogin={() => setState({ configured: true, initialized: true, loggedIn: true })}
    />
  );
}
createRoot(document.getElementById('root')!).render(<App />);
