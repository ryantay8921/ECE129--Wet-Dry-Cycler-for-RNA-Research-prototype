#include <WiFi.h>
#include <ArduinoJson.h>
#include "HEATING.h"
#include "MIXING.h"
#include "REHYDRATION.h"
#include "MOVEMENT.h"
#include "globals.h"
#include "send_functions.h"
#include "handle_functions.h" 
#include "state_websocket.h"  // Add this include to access onWebSocketEvent

#include <stdlib.h> // for atof()

// TESTS
#define TESTING_MAIN

#define Serial0 Serial
#define ServerIP "10.0.0.30"
#define ServerPort 5175

// === Wi-Fi Credentials ===
// const char* ssid = "UCSC-Devices";
// const char* password = "o9ANAjrZ9zkjYKy2yL";

const char *ssid = "DonnaHouse";
const char *password = "guessthepassword";

// const char *ssid = "TheDawgHouse";
// const char *password = "ThrowItBackForPalestine";

// const char *ssid = "UCSC-Guest";
// const char *password = "";

// const char *ssid = "ESP32";
// const char *password = "DontWorry";


unsigned long lastSent = 0; // Last time a message was sent to the server


#ifdef TESTING_MAIN
void setup()
{

  Serial.begin(115200);
  delay(2000); // Allow USB Serial to connect

  // Wi-Fi connect
  Serial.println("Connecting to WiFi...");
  WiFi.begin(ssid, password);
  while (WiFi.status() != WL_CONNECTED)
  {
    delay(500);
    Serial.print(".");
  }
  Serial.println("\nWiFi connected. IP: " + WiFi.localIP().toString());

  webSocket.begin(ServerIP, ServerPort, "/");
  webSocket.onEvent(onWebSocketEvent); // Remove the parentheses, we're passing the function pointer

  Serial0.print("ESP32 MAC Address: ");
  Serial0.println(WiFi.macAddress());
  HEATING_Init();
  MIXING_Init();
  Rehydration_InitAndDisable();
  MOVEMENT_InitAndDisable();// TEST 

  MOVEMENT_ConfigureInterrupts();
  REHYDRATION_ConfigureInterrupts();
  Serial.println("[SYSTEM] Initialization complete. Starting main loop...");
  MOVEMENT_Init();

}

void loop()
{
  webSocket.loop();
  MOVEMENT_HandleInterrupts();
  REHYDRATION_HandleInterrupts();

  unsigned long now = millis();
  switch (currentState)
  {
  case SystemState::IDLE:
    // Await vialSetup packet from frontend
    if (now - lastSent >= 1000)
    {
      sendTemperature();
      sendCycleProgress();
      lastSent = now;
    }
    break;

  case SystemState::VIAL_SETUP:

    if (shouldMoveForward && !movementForwardDone)
    {
      Serial.println("[VIAL_SETUP] Moving forward...");
      MOVEMENT_Move_FORWARD();
      movementForwardDone = true; // Mark forward movement as done
    }
    else if (shouldMoveBack && !movementBackDone)
    {
      Serial.println("[VIAL_SETUP] Flag down — moving backward...");
      MOVEMENT_Move_BACKWARD();
      movementForwardDone = true; // Reset forward movement flag
      Serial.println("VIAL_SETUP] Ended - resuming");
      movementBackDone = false;
      movementForwardDone = false; // Reset both movement flag
      shouldMoveBack = false; // Reset back movement flag
      shouldMoveForward = false; // Reset forward movement flag
      setState(SystemState::WAITING); // Transition to WAITING state
      sendCurrentState();
      sendCycleProgress();
    }
    // Only send state once on entry (handled by setState)
    break;

  case SystemState::WAITING:
    // Await parameters packet from frontend
    // Only send state once on entry (handled by setState)
    if (now - lastSent >= 1000)
    {
      sendTemperature();
      lastSent = now;
    }
    break;

  case SystemState::READY:
    if (now - lastSent >= 1000)
    {
      sendTemperature();
      lastSent = now;
    }
    break;
  case SystemState::PAUSED:
    if (now - lastSent >= 1000)
    {
      sendTemperature();
      lastSent = now;
    }
    break;

  case SystemState::REHYDRATING:
  {
    // Only send state once on entry (handled by setState)
    Serial.println("[STATE] Rehydrating...");
    if (currentCycle >= numberOfCycles)
    {
      Serial.println("[REHYDRATION] Final cycle already completed. Sending end packet and switching to ENDED.");
      sendEndOfCycles();
      setState(SystemState::ENDED);
      sendCurrentState(); // Notify state change to ENDED
      break;
    }
    float uL_per_step = calculate_uL_per_step(syringeDiameter);
    int stepsToMove = (int)(volumeAddedPerCycle / uL_per_step);

    Serial.printf("[REHYDRATION] Dispensing %.2f uL of water using a %.2f inch diameter syringe (%d steps).\n",
                  volumeAddedPerCycle, syringeDiameter, stepsToMove);

    syringeStepCount += stepsToMove;
    Rehydration_Push((uint32_t)volumeAddedPerCycle, syringeDiameter);

    sendSyringePercentage();

    currentState = SystemState::MIXING;
    sendCurrentState();
    break;
  }

  case SystemState::MIXING:
  {
    // The bug: mixingProgressPercent is calculated at the start and likely already >= 100,
    // so the state immediately transitions to HEATING.

    if (!mixingStarted)
    {
      Serial.println("[MIXING] Starting...");
      mixingStartTime = millis();
      mixingDurationRemaining = durationOfMixing * 1000;
      mixingStarted = true;
      mixingProgressPercent = 0.0f; // <-- Reset progress at start
    }
    if (mixingStarted)
    {
      for (int i = 0; i < sampleZoneCount; i++)
      {
        int zone = sampleZonesArray[i];
        int pin = (zone == 1) ? 11 : (zone == 2) ? 12
                                  : (zone == 3)   ? 13
                                                  : -1;
        if (pin != -1)
        {
          MIXING_Motor_OnPin(pin);
        }
      }
    }
    if (now - lastSent >= 1000)
    {
      // Calculate progress based on elapsed time
      float percentDone = ((float)(millis() - mixingStartTime) / (durationOfMixing * 1000.0)) * 100.0;
      if (percentDone > 100.0)
        percentDone = 100.0;
      mixingProgressPercent = percentDone;
      sendMixingProgress();
      lastSent = now;
    }

    // Only update timer if not paused/extracting/refilling
    if (currentState == SystemState::MIXING)
    {
      float percentDone = ((float)(millis() - mixingStartTime) / (durationOfMixing * 1000.0)) * 100.0;
      if (percentDone >= 100.0f)
      {
        Serial.println("[MIXING] Done. Turning off motors.");
        MIXING_AllMotors_Off();
        mixingStarted = false;
        setState(SystemState::HEATING);
      }
    }
    break;
  }

  case SystemState::HEATING:
{
    if (!heatingStarted)
    {
        Serial.printf("[HEATING] Starting... durationOfHeating = %.2f\n", durationOfHeating);
        heatingStartTime = millis();
        heatingStarted = true;
        heatingProgressPercent = 0.0f;
    }

    if (heatingStarted)
    {
        HEATING_Set_Temp((int)desiredHeatingTemperature);
    }

    if (now - lastSent >= 1000)
    {
        sendTemperature();
        float percentDone = ((float)(millis() - heatingStartTime) / (durationOfHeating * 1000.0f)) * 100.0f;
        if (percentDone > 100.0f) percentDone = 100.0f;
        heatingProgressPercent = percentDone;
        sendHeatingProgress();
        lastSent = now;
    }

    if (heatingProgressPercent >= 100.0f)
    {
        Serial.println("[HEATING] Done. Turning off heater.");
        HEATING_Off();
        heatingStarted = false;
        completedCycles++;
        currentCycle++;
        sendCycleProgress();
        setState(SystemState::REHYDRATING);
    }
  }
    break;


  case SystemState::REFILLING:
    if (!refillingStarted)
    {
      Serial.println("[STATE] REFILLING: Moving back until back bumper is hit");
      Rehydration_BackUntilBumper(); // Retract fully
      syringeStepCount = 0;          // Reset step counter
      sendSyringeResetInfo();        // Notify webserver
      refillingStarted = true;
    }
    break;

  case SystemState::EXTRACTING:
    if (shouldMoveForward && !movementForwardDone)
    {
      Serial.println("[EXTRACTING] Moving forward...");
      MOVEMENT_Move_FORWARD();
      movementForwardDone = true; // Mark forward movement as done
      sendExtractionReady(); // Notify frontend that extraction is ready
    }
    else if (shouldMoveBack && !movementBackDone)
    {
      Serial.println("[EXTRACTING] Flag down — moving backward...");
      MOVEMENT_Move_BACKWARD();
      movementForwardDone = true; // Reset forward movement flag
      Serial.println("Extraction ended — resuming");
      movementBackDone = false;
      movementForwardDone = false; // Reset both movement flag
      shouldMoveBack = false; // Reset back movement flag
      shouldMoveForward = false; // Reset forward movement flag
      setState(previousState); // Use setState to restore timers and state
      sendCurrentState();
    }
    break;

  case SystemState::LOGGING:
    Serial.println("Logging data...");
    currentState = previousState;
    sendCurrentState();
    break;

  case SystemState::ENDED:
    completedCycles = 0;
    currentCycle = 0;
    currentState = SystemState::VIAL_SETUP;
    sendCurrentState();
    break;

  case SystemState::ERROR:
    Serial.println("System error — awaiting reset or external command.");
    break;
  }
  delay(10);
}

#endif // TESTING_MAIN
