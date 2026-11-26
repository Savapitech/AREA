<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

class VerifyHookSignature
{
    public function handle(Request $request, Closure $next): Response
    {
        $signature = $request->header('X-Hook-Signature');

        if (!$signature) {
            return response()->json(['message' => 'Missing signature'], 401);
        }

        $expected = 'sha256=' . hash_hmac('sha256', $request->getContent(), config('poc.hook_secret'));

        if (!hash_equals($expected, $signature)) {
            return response()->json(['message' => 'Invalid signature'], 401);
        }

        return $next($request);
    }
}
