<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Concerns\HasUuids;
use Illuminate\Database\Eloquent\Model;

class HookEvent extends Model
{
    use HasUuids;

    public $timestamps = false;

    protected $fillable = [
        'source',
        'external_id',
        'payload',
    ];

    protected function casts(): array
    {
        return [
            'payload' => 'array',
            'received_at' => 'datetime',
        ];
    }
}
