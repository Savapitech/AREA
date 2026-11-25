<?php

use Illuminate\Http\Request;
use Illuminate\Support\Facades\Route;
use App\Http\Controllers\AuthController;

Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::get('/auth/me', [AuthController::class, 'me']);

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'framework' => 'laravel'
    ]);
});

Route::post('/webhook', function (Request $request) {
    $data = $request->validate([
        'eventType' => 'required|string',
        'payload' => 'required|array'
    ]);

    return response()->json([
        'received' => true,
        'eventType' => $data['eventType'],
        'payload' => $data['payload']
    ]);
});

Route::get('/user', function (Request $request) {
    return $request->user();
})->middleware('auth:sanctum');
