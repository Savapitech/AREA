import { useState } from 'react'
import { ReactFlow, Background, Controls, addEdge } from '@xyflow/react'
import '@xyflow/react/style.css'

const initialNodes = [
    { id: 'trigger', position: { x: 0, y: 0 }, data: { label: 'Trigger : nouveau mail' } },
    { id: 'cond', position: { x: 0, y: 100 }, data: { label: 'Condition : expéditeur == Savinien ?' } },
    { id: 'r1', position: { x: -150, y: 200 }, data: { label: 'Réaction : message Discord' } },
    { id: 'r2', position: { x: 150, y: 200 }, data: { label: 'Réaction : archiver le mail' } },
]

const initialEdges = [
    { id: 'e1', source: 'trigger', target: 'cond' },
    { id: 'e2', source: 'cond', target: 'r1', label: 'oui' },
    { id: 'e3', source: 'cond', target: 'r2', label: 'non' },
]

export default function Builder() {
    const [nodes, setNodes] = useState(initialNodes)
    const [edges, setEdges] = useState(initialEdges)

    return (
        <div style={{ width: '100vw', height: '100vh' }}>
            <ReactFlow
                nodes={nodes}
                edges={edges}
                onNodesChange={(changes) => setNodes((nds) => changes.applyTo(nds))}
                onEdgesChange={(changes) => setEdges((eds) => changes.applyTo(eds))}
                onConnect={(params) => setEdges((eds) => addEdge(params, eds))}
                fitView
            >
                <Background />
                <Controls />
            </ReactFlow>
        </div>
    )
}