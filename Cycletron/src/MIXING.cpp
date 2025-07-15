/**
 * @file    MIXING.cpp
 * @brief   DC Motor control module using GPIO pins (Arduino/ESP32 compatible).
 *
 * Provides initialization and control functions for mixing motors.
 *
 * @author  Rafael Delwart
 * @date    25 Feb 2025 adapted for ESP 13 May 2025
 */

#include <Arduino.h>
#include "MIXING.h"


// NOTE FOR VIKAS:
// PWM control of mixing motors, the speed is controlled by the power value
// 0 stops the motor, 255 is full speed. 
#define mixingMotorPower 177 // Default motor power (0-255), can be set from backend





#define mixingMotorPWMFrequency 500 // PWM frequency in Hz
#define TESTING_MIXING

// === CONFIG ===
#define MIX1_GPIO 11
#define MIX2_GPIO 12
#define MIX3_GPIO 13

// Define motor GPIOs and corresponding PWM channels
static const uint8_t motorPins[] = {MIX1_GPIO, MIX2_GPIO, MIX3_GPIO};
static const uint8_t motorChannels[] = {0, 1, 2}; // One channel per motor
static const int NUM_MOTORS = sizeof(motorPins) / sizeof(motorPins[0]);

// === API IMPLEMENTATION ===

/**
 * @brief Initializes all mixing motor GPIOs as PWM outputs (500Hz) and sets them LOW.
 */
void MIXING_Init() {
  for (int i = 0; i < NUM_MOTORS; i++) {
    pinMode(motorPins[i], OUTPUT);
    ledcSetup(motorChannels[i], mixingMotorPWMFrequency, 8);           // 500 Hz, 8-bit resolution
    ledcAttachPin(motorPins[i], motorChannels[i]); // Link pin to channel
    ledcWrite(motorChannels[i], 0);                // Motors off by default
  }
  Serial.println("[MIXING] All motors initialized and set to OFF");
}

/**
 * @brief Turns ON the motor connected to the given GPIO pin.
 * @param pin GPIO pin number
 */
void MIXING_Motor_OnPin(uint8_t pin)
{
  for (int i = 0; i < NUM_MOTORS; i++) {
    if (motorPins[i] == pin) {
      ledcWrite(motorChannels[i], mixingMotorPower);
      return;
    }
  }
}

/**
 * @brief Turns OFF the motor connected to the given GPIO pin.
 * @param pin GPIO pin number
 */
void MIXING_Motor_OffPin(uint8_t pin) {
  for (int i = 0; i < NUM_MOTORS; i++) {
    if (motorPins[i] == pin) {
      ledcWrite(motorChannels[i], 0);
      return;
    }
  }
}

/**
 * @brief Turns ON all defined motors.
 */
void MIXING_AllMotors_On() {
  for (int i = 0; i < NUM_MOTORS; i++) {
    ledcWrite(motorChannels[i], mixingMotorPower);
  }
}

/**
 * @brief Turns OFF all defined motors.
 */
void MIXING_AllMotors_Off() {
  for (int i = 0; i < NUM_MOTORS; i++) {
    ledcWrite(motorChannels[i], 0);
  }
}

// === TEST LOOP ===
// This section is for testing the mixing motors.
#ifdef TESTING_MIXING

void setup() {
  Serial.begin(115200);
  MIXING_Init();
}

void loop() {
  // Step through each motor
  for (int i = 0; i < NUM_MOTORS; i++) {
    Serial.printf("[TEST] Turning ON motor %d (GPIO %d)\n", i + 1, motorPins[i]);
    MIXING_Motor_OnPin(motorPins[i]);
    delay(10000); // ON for 10 seconds

    Serial.printf("[TEST] Turning OFF motor %d (GPIO %d)\n", i + 1, motorPins[i]);
    MIXING_Motor_OffPin(motorPins[i]);
    delay(3000);  // OFF for 3 seconds
  }

  // All motors ON
  Serial.println("[TEST] Turning ALL motors ON");
  MIXING_AllMotors_On();
  delay(20000);

  // All motors OFF
  Serial.println("[TEST] Turning ALL motors OFF");
  MIXING_AllMotors_Off();
  delay(5000);
}

#endif // TESTING_MIXING