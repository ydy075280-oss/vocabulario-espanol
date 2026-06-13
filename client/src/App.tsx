import React from 'react';
import { Routes, Route, Navigate } from 'react-router-dom';
import { useAuth } from './context/AuthContext';
import AuthPage from './pages/AuthPage';
import Dashboard from './pages/Dashboard';
import UploadPage from './pages/UploadPage';
import WordbookList from './pages/WordbookList';
import WordbookDetail from './pages/WordbookDetail';
import LearnPage from './pages/LearnPage';
import CreatePage from './pages/CreatePage';
import ModuleListPage from './pages/ModuleListPage';
import ModuleDetailPage from './pages/ModuleDetailPage';
import ProfilePage from './pages/ProfilePage';
import Layout from './components/Layout';
import Loading from './components/Loading';
import PWAInstallBanner from './components/PWAInstallBanner';

export default function App() {
  const { user, loading } = useAuth();

  if (loading) return <Loading full />;

    return (
    <>
    <Routes>
      <Route path="/auth" element={user ? <Navigate to="/" replace /> : <AuthPage />} />
      <Route
        path="/*"
        element={
          user ? (
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/upload" element={<UploadPage />} />
                <Route path="/wordbooks" element={<WordbookList />} />
                <Route path="/wordbooks/:id" element={<WordbookDetail />} />
                <Route path="/learn/:wordbookId" element={<LearnPage />} />
                <Route path="/learn" element={<LearnPage />} />
                <Route path="/create" element={<CreatePage />} />
                <Route path="/modules" element={<ModuleListPage />} />
                <Route path="/modules/:id" element={<ModuleDetailPage />} />
                <Route path="/profile" element={<ProfilePage />} />
              </Routes>
            </Layout>
          ) : (
            <Navigate to="/auth" replace />
          )
        }
      />
    </Routes>
      <PWAInstallBanner />
    </>
  );
}
