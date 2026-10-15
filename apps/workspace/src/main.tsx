import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import AdminAccess from './AdminAccess'
import './style.css'
import './maps/map.css'

ReactDOM.createRoot(document.getElementById('root')!).render(<React.StrictMode><AdminAccess><App /></AdminAccess></React.StrictMode>)
