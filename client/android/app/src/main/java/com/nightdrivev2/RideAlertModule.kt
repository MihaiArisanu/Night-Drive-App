package com.nightdrivev2

import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Handler
import android.os.Looper
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.bridge.ReactContextBaseJavaModule
import com.facebook.react.bridge.ReactMethod

class RideAlertModule(
  reactContext: ReactApplicationContext,
) : ReactContextBaseJavaModule(reactContext) {

  override fun getName(): String = "RideAlert"

  @ReactMethod
  fun play() {
    val tone = ToneGenerator(AudioManager.STREAM_NOTIFICATION, 80)
    tone.startTone(ToneGenerator.TONE_PROP_BEEP2, 350)
    Handler(Looper.getMainLooper()).postDelayed({ tone.release() }, 500)
  }
}
