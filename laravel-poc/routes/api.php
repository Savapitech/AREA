<?php

use App\Http\Controllers\AuthController;
use App\Http\Controllers\HooksController;
use Illuminate\Support\Facades\Route;

Route::post('/auth/register', [AuthController::class, 'register']);
Route::post('/auth/login', [AuthController::class, 'login']);
Route::get('/auth/me', [AuthController::class, 'me'])->middleware('jwt');

Route::post('/hooks/webhook', [HooksController::class, 'webhook'])->middleware('hook.signature');
Route::get('/hooks/events', [HooksController::class, 'events'])->middleware('jwt');

Route::get('/health', function () {
    return response()->json([
        'status' => 'ok',
        'framework' => 'laravel',
    ]);
});
