import React from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Routes, Route, Navigate, Link } from 'react-router';
import { QueryClientProvider } from '@tanstack/react-query';
import { queryClient } from './api';
import {PageMotion} from './PageMotion';
import {SessionBoundary} from './SessionBoundary';
const Account=React.lazy(()=>import('./pages/Account').then(m=>({default:m.Account})));
const Landing=React.lazy(()=>import('./pages/Landing').then(m=>({default:m.Landing})));
const AuthPage=React.lazy(()=>import('./pages/Auth').then(m=>({default:m.AuthPage})));
const JoinPage=React.lazy(()=>import('./pages/Auth').then(m=>({default:m.JoinPage})));
const Chooser=React.lazy(()=>import('./pages/Workspace').then(m=>({default:m.Chooser})));
const Workspace=React.lazy(()=>import('./pages/Workspace').then(m=>({default:m.Workspace})));
const ProjectPage=React.lazy(()=>import('./pages/Planning').then(m=>({default:m.ProjectPage})));
import '@fontsource/geist/400.css';
import '@fontsource/geist/500.css';
import '@fontsource/geist/600.css';
import '@fontsource/geist/700.css';
import './styles.css';
import './taste-theme.css';
function App(){return <BrowserRouter><PageMotion/><React.Suspense fallback={<div className="loading" role="status">Loading…</div>}><Routes>
  <Route path="/" element={<Landing/>}/>
  {['login','register','verify-email','forgot-password','reset-password'].map(mode=><Route key={mode} path={'/'+mode} element={<AuthPage mode={mode}/>}/>)}
  <Route path="/invite" element={<JoinPage kind="invite"/>}/><Route path="/join" element={<JoinPage kind="join"/>}/>
  <Route path="/account" element={<Account/>}/>
  <Route path="/workspaces" element={<Chooser/>}/>
  <Route path="/w/:workspaceId/p/:projectId/*" element={<ProjectPage/>}/>
  <Route path="/w/:workspaceId/*" element={<Workspace/>}/>
  <Route path="*" element={<div className="standalone"><h1>Page not found</h1><Link to="/workspaces">Back to your workspaces</Link></div>}/>
</Routes></React.Suspense></BrowserRouter>}
createRoot(document.getElementById('root')!).render(<React.StrictMode><QueryClientProvider client={queryClient}><SessionBoundary><App/></SessionBoundary></QueryClientProvider></React.StrictMode>);
