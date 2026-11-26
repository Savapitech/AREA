<?php

use App\Services\HookRecorder;
use Illuminate\Foundation\Inspiring;
use Illuminate\Support\Facades\Artisan;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Schedule;

Artisan::command('inspire', function () {
    $this->comment(Inspiring::quote());
})->purpose('Display an inspiring quote');

Schedule::call(function (HookRecorder $recorder) {
    $occurrence = intdiv(time(), 60);
    $isNew = $recorder->record('timer', (string) $occurrence, [
        'tickAt' => date(DATE_ATOM, $occurrence * 60),
    ]);

    if ($isNew) {
        Log::info("timer.tick {$occurrence} detected, workflow would start here");
    }
})->name('timer.tick')->everyTenSeconds();
