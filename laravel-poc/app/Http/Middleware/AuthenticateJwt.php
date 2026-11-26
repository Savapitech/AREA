<?php

namespace App\Http\Middleware;

use App\Models\User;
use Closure;
use Firebase\JWT\JWT;
use Firebase\JWT\Key;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;
use Throwable;

class AuthenticateJwt
{
    public function handle(Request $request, Closure $next): Response
    {
        $token = $request->bearerToken();

        if (!$token) {
            return $this->unauthorized();
        }

        try {
            $decoded = JWT::decode($token, new Key(config('poc.jwt_secret'), 'HS256'));
        } catch (Throwable) {
            return $this->unauthorized();
        }

        $user = User::find($decoded->sub);

        if (!$user) {
            return $this->unauthorized();
        }

        $request->setUserResolver(fn () => $user);

        return $next($request);
    }

    private function unauthorized(): Response
    {
        return response()->json(['message' => 'Unauthorized'], 401);
    }
}
