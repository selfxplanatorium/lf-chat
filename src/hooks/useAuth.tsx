import React, { useState, createContext, useContext, useEffect, useCallback } from 'react';
import { setAuthToken, getAuthToken, setAuthFailureHandler, login as apiLogin, getMe } from '../services/apiClient';
import { useToast } from '../components/Toast';
import { useI18n } from '../i18n';

export interface User {
  id: string;
  email: string;
  name: string;
  isAdmin?: boolean;
}

interface AuthContextType {
  user: User | null;
  token: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (email: string, password: string) => Promise<void>;
  setUserFromToken: (token: string, user: User) => void;
  logout: () => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [token, setTokenState] = useState<string | null>(getAuthToken());
  const [isLoading, setIsLoading] = useState(true);
  const { addToast } = useToast();
  const { t } = useI18n();

  const logout = useCallback(() => {
    setAuthToken(null);
    setTokenState(null);
    setUser(null);
  }, []);

  useEffect(() => {
    // A 401 from any API call (expired/revoked token) logs the user out and
    // surfaces a clear reason, instead of leaving a stale session that fails
    // on every subsequent request.
    setAuthFailureHandler(() => {
      logout();
      addToast('info', t('errors.sessionExpired'));
    });
    return () => setAuthFailureHandler(null);
  }, [logout, addToast, t]);

  useEffect(() => {
    const savedToken = getAuthToken();
    if (savedToken) {
      getMe()
        .then((data) => {
          setUser(data.user);
          setTokenState(savedToken);
        })
        .catch(() => {
          setAuthToken(null);
          setTokenState(null);
          setUser(null);
        })
        .finally(() => setIsLoading(false));
    } else {
      setIsLoading(false);
    }
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const data = await apiLogin(email, password);
    setAuthToken(data.token);
    setTokenState(data.token);
    setUser(data.user);
  }, []);

  const setUserFromToken = useCallback((token: string, user: User) => {
    setAuthToken(token);
    setTokenState(token);
    setUser(user);
  }, []);

  return (
    <AuthContext.Provider value={{ user, token, isLoading, isAuthenticated: !!user, login, setUserFromToken, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
