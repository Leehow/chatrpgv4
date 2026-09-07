import './browser-polyfills'
import React from 'react'
import ReactDOM from 'react-dom/client'
import { createMockHost } from './mock-host'
import { RemoteBrowserApp } from './RemoteBrowserApp'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RemoteBrowserApp demoHost={() => createMockHost({ productPacks: true })} />
  </React.StrictMode>
)
