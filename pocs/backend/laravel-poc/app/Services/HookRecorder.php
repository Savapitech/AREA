<?php

namespace App\Services;

use App\Models\HookEvent;
use Illuminate\Database\UniqueConstraintViolationException;

class HookRecorder
{
    public function record(string $source, string $externalId, ?array $payload): bool
    {
        try {
            HookEvent::create([
                'source' => $source,
                'external_id' => $externalId,
                'payload' => $payload,
            ]);

            return true;
        } catch (UniqueConstraintViolationException) {
            return false;
        }
    }
}
