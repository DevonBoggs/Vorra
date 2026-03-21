// Route definitions for Vorra
// Uses HashRouter for Electron compatibility (works with file:// protocol)

import { HashRouter, Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';

// Route configuration mapping nav keys to paths
export const ROUTES = {
  dashboard: '/',
  courses:   '/courses',
  planner:   '/planner',
  daily:     '/daily',
  calendar:  '/calendar',
  chat:      '/chat',
  quiz:      '/quiz',
  report:    '/report',
  ambient:   '/ambient',
  settings:  '/settings',
};

// Hook that provides setPage-compatible navigation
// Returns { page, setPage, navigate } for backward compat
export function usePageNav() {
  const navigate = useNavigate();
  const location = useLocation();

  // Derive current "page" key from path
  const page = Object.entries(ROUTES).find(
    ([_, path]) => path === location.pathname
  )?.[0] || 'dashboard';

  // setPage compatible function
  const setPage = (key) => {
    const path = ROUTES[key] || '/';
    navigate(path);
  };

  return { page, setPage, navigate };
}

// Router wrapper component
export function AppRouter({ children }) {
  return (
    <HashRouter>
      <Routes>
        <Route path="*" element={children} />
      </Routes>
    </HashRouter>
  );
}
