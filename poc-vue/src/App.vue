<script setup lang="ts">
import { ref } from 'vue'
import { VueFlow, Position, type Node, type Edge, type Connection } from '@vue-flow/core'
import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'

const isLoggedIn = ref(false)
const username = ref('')
const password = ref('')

function login() {
  if (!username.value.trim()) username.value = 'user'
  isLoggedIn.value = true
}

const triggerName = ref('')
let nextId = 2

const nodes = ref<Node[]>([
  {
    id: 'main',
    label: 'Trigger main',
    position: { x: 80, y: 180 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    class: 'node-main',
  },
  {
    id: '1',
    label: 'Trigger #1',
    position: { x: 420, y: 180 },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    class: 'node-sub',
  },
])

const edges = ref<Edge[]>([
  { id: 'e-main-1', source: 'main', target: '1', animated: true },
])

function addTrigger(autoLink: boolean) {
  const id = String(nextId++)
  const label = triggerName.value.trim() || `trigger #${id}`
  const y = 70 + (nodes.value.length - 1) * 100

  nodes.value.push({
    id,
    label,
    position: { x: 420, y },
    sourcePosition: Position.Right,
    targetPosition: Position.Left,
    class: 'node-sub',
  })

  if (autoLink) {
    edges.value.push({ id: `e-main-${id}`, source: 'main', target: id, animated: true })
  }
  triggerName.value = ''
}

function handleConnect(params: Connection) {
  edges.value.push({
    id: `e-${params.source}-${params.target}-${Date.now()}`,
    source: params.source,
    target: params.target,
    animated: true,
  })
}
</script>

<template>
  <main v-if="!isLoggedIn" class="login-page">
    <form class="login-card" @submit.prevent="login">
      <h1>Connexion AREA</h1>
      <input v-model="username" type="text" placeholder="Identifiant" />
      <input v-model="password" type="password" placeholder="Mot de passe" />
      <button type="submit" class="btn-primary">Se connecter</button>
    </form>
  </main>

  <div v-else class="builder-page">
    <header class="bar">
      <strong> AREA Builder</strong>
      <div class="controls">
        <input
          v-model="triggerName"
          type="text"
          placeholder="Nom du trigger..."
          @keyup.enter="addTrigger(true)"
        />
        <button class="btn-primary" @click="addTrigger(true)">+ Ajouter relié</button>
        <button class="btn-secondary" @click="addTrigger(false)">+ Trigger libre</button>
      </div>
      <button class="btn-secondary" @click="isLoggedIn = false">{{ username }} (Quitter)</button>
    </header>

    <div class="canvas">
      <VueFlow
        v-model:nodes="nodes"
        v-model:edges="edges"
        fit-view-on-init
        @connect="handleConnect"
      />
    </div>
  </div>
</template>

<style scoped>
:global(body),
:global(#app) {
  margin: 0;
  padding: 0;
  width: 100%;
  max-width: none;
  min-height: 100vh;
  background: #0f172a;
  color: #f8fafc;
  font-family: system-ui, -apple-system, sans-serif;
}

.login-page {
  min-height: 100vh;
  display: grid;
  place-items: center;
}

.login-card {
  width: 320px;
  background: #1e293b;
  border: 1px solid #334155;
  border-radius: 14px;
  padding: 28px;
  display: flex;
  flex-direction: column;
  gap: 12px;
  box-shadow: 0 20px 50px rgba(0, 0, 0, 0.4);
}

.login-card h1 {
  margin: 0 0 6px;
  font-size: 22px;
}

.builder-page {
  height: 100vh;
  display: flex;
  flex-direction: column;
}

.bar {
  padding: 12px 20px;
  background: #1e293b;
  border-bottom: 1px solid #334155;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.controls {
  display: flex;
  gap: 8px;
}

input {
  padding: 9px 12px;
  border-radius: 8px;
  border: 1px solid #475569;
  background: #0f172a;
  color: #f8fafc;
  font-size: 14px;
}

button {
  padding: 9px 14px;
  border-radius: 8px;
  font-weight: 600;
  cursor: pointer;
  border: none;
}

.btn-primary {
  background: #2563eb;
  color: #fff;
}

.btn-secondary {
  background: #334155;
  color: #e2e8f0;
}

.canvas {
  flex: 1;
  background-image: radial-gradient(#334155 1px, transparent 1px);
  background-size: 20px 20px;
}

:deep(.vue-flow__node) {
  border-radius: 12px;
  padding: 12px 18px;
  font-weight: 600;
  box-shadow: 0 10px 25px rgba(0, 0, 0, 0.35);
}

:deep(.vue-flow__node.node-main) {
  background: linear-gradient(135deg, #2563eb, #0284c7);
  color: #fff;
  border: 1px solid #7dd3fc;
}

:deep(.vue-flow__node.node-sub) {
  background: #1e293b;
  color: #f8fafc;
  border: 1px solid #475569;
}

:deep(.vue-flow__edge-path) {
  stroke: #38bdf8;
  stroke-width: 2.5;
}
</style>