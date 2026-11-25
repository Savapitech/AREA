<?php

namespace App\Http\Controllers;

use App\Models\User;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Throwable;

class AuthController extends Controller
{
    public function register(Request $request)
    {
        $data = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string|min:8',
        ]);

        if (User::where('email', $data['email'])->exists()) {
            return response()->json([
                'message' => 'Email already registered',
            ], 409);
        }

        $user = User::create([
            'email' => $data['email'],
            'password' => Hash::make($data['password']),
        ]);

        return response()->json([
            'id' => $user->id,
            'email' => $user->email,
        ], 201);
    }

    public function login(Request $request)
    {
        $data = $request->validate([
            'email' => 'required|email',
            'password' => 'required|string|min:8',
        ]);

        $user = User::where('email', $data['email'])->first();

        if (!$user || !Hash::check($data['password'], $user->password)) {
            return response()->json([
                'message' => 'Invalid credentials',
            ], 401);
        }

        $now = time();

        $token = JWT::encode([
            'sub' => $user->id,
            'email' => $user->email,
            'iat' => $now,
            'exp' => $now + 3600,
        ], config('poc.jwt_secret'), 'HS256');

        return response()->json([
            'access_token' => $token,
        ]);
    }

    public function me(Request $request)
    {
        $token = $request->bearerToken();

        if (!$token) {
            return response()->json([
                'message' => 'Unauthorized',
            ], 401);
        }

        try {
            $decoded = JWT::decode(
                $token,
                new Key(config('poc.jwt_secret'), 'HS256')
            );

            $user = User::find($decoded->sub);

            if (!$user) {
                return response()->json([
                    'message' => 'Unauthorized',
                ], 401);
            }

            return response()->json([
                'id' => $user->id,
                'email' => $user->email,
            ]);
        } catch (Throwable $error) {
            return response()->json([
                'message' => 'Unauthorized',
            ], 401);
        }
    }
}
