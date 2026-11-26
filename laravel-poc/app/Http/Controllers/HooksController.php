<?php

namespace App\Http\Controllers;

use App\Models\HookEvent;
use App\Services\HookRecorder;
use Illuminate\Http\Request;

class HooksController extends Controller
{
    public function webhook(Request $request, HookRecorder $recorder)
    {
        $data = $request->validate([
            'eventId' => 'required|string|min:1',
            'eventType' => 'required|string',
            'payload' => 'required|array',
        ]);

        $isNew = $recorder->record('webhook', $data['eventId'], [
            'eventType' => $data['eventType'],
            ...$data['payload'],
        ]);

        return response()->json([
            'received' => true,
            'duplicate' => !$isNew,
        ]);
    }

    public function events()
    {
        return response()->json(
            HookEvent::orderByDesc('received_at')->limit(20)->get()
        );
    }
}
