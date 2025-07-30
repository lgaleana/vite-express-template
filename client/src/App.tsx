import { Routes, Route } from 'react-router-dom'

function App() {
  return (
    <Routes>
      <Route path="/" element={
        <div className="p-4">
          <h1 className="text-2xl font-bold">React + Vite + TypeScript + Tailwind</h1>
          <p className="text-gray-600">Running ✓</p>
        </div>
      } />
    </Routes>
  )
}

export default App
