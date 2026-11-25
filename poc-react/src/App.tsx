import { useState } from 'react'

export default function App() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!email || !password) {
      setError('Remplis tous les champs')
      return
    }
    try {
      if (email !== 'poc@area.dev') throw new Error()
      alert('Connecté !')
    } catch {
      setError('Identifiants incorrects')
    }
  }

  return (
    <main>
      <h1>Connexion</h1>
      <form onSubmit={handleSubmit}>
        <label htmlFor="email">Email</label>
        <input id="email" type="email" value={email}
          onChange={(e) => setEmail(e.target.value)} />

        <label htmlFor="password">Mot de passe</label>
        <input id="password" type="password" value={password}
          onChange={(e) => setPassword(e.target.value)} />

        {error && <p role="alert">{error}</p>}
        <button type="submit">Se connecter</button>
      </form>
    </main>
  )
}
