#include <ArduinoJson.h>
#include "globals.h"
#include "send_functions.h"
#include "handle_functions.h"
#include "globals.h"

/**
 * @brief Converts a command string to its corresponding CommandType enum.
 *
 * Supports known command keywords such as "vialSetup", "startCycle", etc.
 * Returns CommandType::UNKNOWN for unrecognized commands.
 *
 * @param name Command string from user or client
 * @return Corresponding CommandType enum
 */
CommandType parseCommand(const String &name)
{
    if (name == "vialSetup")
        return CommandType::VIAL_SETUP;
    if (name == "startCycle")
        return CommandType::START_CYCLE;
    if (name == "pauseCycle")
        return CommandType::PAUSE_CYCLE;
    if (name == "endCycle")
        return CommandType::END_CYCLE;
    if (name == "extract")
        return CommandType::EXTRACT;
    if (name == "refill")
        return CommandType::REFILL;
    if (name == "logCycle")
        return CommandType::LOG_CYCLE;
    if (name == "restartESP32")
        return CommandType::RESTART_ESP32;
    return CommandType::UNKNOWN;
}

/**
 * @brief Handles command and state transitions received from client.
 *
 * Interprets commands such as vial setup, start/pause/end cycle,
 * extraction, refill, and logging. Updates internal system state
 * and triggers mechanical actions accordingly.
 *
 * @param name Name of the command (e.g., "startCycle")
 * @param state Desired state or instruction (e.g., "on", "yes")
 */
void handleStateCommand(const String &name, const String &state)
{
    // Prevent commands unless system is out of IDLE (except for vialSetup)
    if (parseCommand(name) != CommandType::VIAL_SETUP && currentState == SystemState::IDLE)
    {
        Serial.println("[IGNORED] System is IDLE — waiting for vialSetup command.");
        return;
    }

    CommandType cmd = parseCommand(name);

    switch (cmd)
    {
    case CommandType::VIAL_SETUP:
        // Handle different states during vial setup
        if (state == "yes")
        {
            setState(SystemState::VIAL_SETUP);
            shouldMoveForward = true;
            Serial.println("State changed to VIAL_SETUP");
        }
        else if (state == "continue")
        {
            shouldMoveBack = true;
            Serial.println("Continuing vial setup (backward movement)");
        }
        else if (state == "no")
        {
            setState(SystemState::WAITING);
            Serial.println("State changed to WAITING");

        }
        else
        {
            Serial.printf("[ERROR] Unknown state for vialSetup: '%s'\n", state.c_str());
        }
        break;

    case CommandType::START_CYCLE:
        if (state == "on")
        {
            setState(SystemState::HEATING);
            Serial.println("State changed to HEATING");
        }
        break;

    case CommandType::PAUSE_CYCLE:
        if (state == "on")
        {
            setState(SystemState::PAUSED);
            Serial.println("State changed to PAUSED");
        }
        else
        {
            setState(previousState);
            Serial.printf("Resumed — currentState = %d\n", static_cast<int>(currentState));
        }
        break;

    case CommandType::END_CYCLE:
        if (state == "on")
        {
            setState(SystemState::ENDED);
            Serial.println("State changed to ENDED");
        }
        break;

    case CommandType::EXTRACT:
        if (state == "on")
        {
            setState(SystemState::EXTRACTING);
            shouldMoveForward = true;
            Serial.println("Extraction started");
        }
        else
        {
            shouldMoveBack = true;
            Serial.println("Extraction back movement requested");
        }
        break;

    case CommandType::REFILL:
        if (state == "on")
        {
            setState(SystemState::REFILLING);
            Serial.println("Refill started");
        }
        else
        {
            refillingStarted = false; // Reset the flag for next time
            setState(previousState); // Use setState to restore timers and state
            Serial.println("Refill ended — resuming previous state");
        }
        break;

    case CommandType::LOG_CYCLE:
        if (state == "on")
        {
            setState(SystemState::LOGGING);
            Serial.println("State changed to LOGGING");
        }
        break;


    case CommandType::RESTART_ESP32:
        if (state == "on")
        {
            Serial.println("Restart command received — restarting ESP32...");
            delay(100);
            ESP.restart();
        }
        break;

    case CommandType::UNKNOWN:
    default:
        Serial.printf("[ERROR] Unknown or unhandled command: name = '%s', state = '%s'\n", name.c_str(), state.c_str());
        break;
    }
}

/**
 * @brief Restores system state and parameters from a JSON recovery packet.
 *
 * Used to recover previous state and operational parameters after restart or crash.
 * Parses the state string and various configuration values.
 *
 * @param data JSON object containing recovery state and parameters
 */
void handleRecoveryPacket(JsonObject data)
{
    if (!data["currentState"].is<const char *>() || !data["parameters"].is<JsonObject>())
    {
        Serial.println("Recovery packet is empty or invalid. Transitioning to IDLE state.");
        currentState = SystemState::IDLE;
        return;
    }

    // Restore the last known operational state
    String recoveredState = data["currentState"].as<String>();
    if (recoveredState == "IDLE")
        setState(SystemState::IDLE);
    else if (recoveredState == "VIAL_SETUP")
        setState(SystemState::VIAL_SETUP);
    else if (recoveredState == "WAITING")
        setState(SystemState::WAITING);
    else if (recoveredState == "READY")
        setState(SystemState::READY);
    else if (recoveredState == "HEATING")
        setState(SystemState::HEATING);
    else if (recoveredState == "REHYDRATING")
        setState(SystemState::REHYDRATING);
    else if (recoveredState == "MIXING")
        setState(SystemState::MIXING);
    else if (recoveredState == "EXTRACTING")
        setState(SystemState::EXTRACTING);
    else if (recoveredState == "REFILLING")
        setState(SystemState::REFILLING);
    else if (recoveredState == "PAUSED")
        setState(SystemState::PAUSED);
    else if (recoveredState == "ENDED")
        setState(SystemState::ENDED);
    else if (recoveredState == "LOGGING")
        setState(SystemState::LOGGING);
    else
        setState(SystemState::IDLE);

    // Restore parameters
    JsonObject parameters = data["parameters"];
    volumeAddedPerCycle = parameters["volumeAddedPerCycle"].is<const char *>() ? atof(parameters["volumeAddedPerCycle"].as<const char *>()) : parameters["volumeAddedPerCycle"].as<float>();
    volumeAddedPerCycle = volumeAddedPerCycle * 12; // Change input from total liquid to volume per vial.
    syringeDiameter = parameters["syringeDiameter"].is<const char *>() ? atof(parameters["syringeDiameter"].as<const char *>()) : parameters["syringeDiameter"].as<float>();
    desiredHeatingTemperature = parameters["desiredHeatingTemperature"].is<const char *>() ? atof(parameters["desiredHeatingTemperature"].as<const char *>()) : parameters["desiredHeatingTemperature"].as<float>();
    durationOfHeating = parameters["durationOfHeating"].is<const char *>() ? atof(parameters["durationOfHeating"].as<const char *>()) : parameters["durationOfHeating"].as<float>();
    durationOfHeating = durationOfHeating * 60; // Convert seconds to minutes
    durationOfMixing = parameters["durationOfMixing"].is<const char *>() ? atof(parameters["durationOfMixing"].as<const char *>()) : parameters["durationOfMixing"].as<float>();
    numberOfCycles = parameters["numberOfCycles"].is<const char *>() ? atoi(parameters["numberOfCycles"].as<const char *>()) : parameters["numberOfCycles"].as<int>();
    // syringeStepCount = parameters["syringeStepCount"].is<const char *>() ? atoi(parameters["syringeStepCount"].as<const char *>()) : parameters["syringeStepCount"].as<int>();
    heatingStartTime = parameters["heatingStartTime"].is<const char *>() ? atol(parameters["heatingStartTime"].as<const char *>()) : parameters["heatingStartTime"].as<long>();
    heatingStarted = parameters["heatingStarted"].is<bool>() ? parameters["heatingStarted"].as<bool>() : false;
    mixingStartTime = parameters["mixingStartTime"].is<const char *>() ? atol(parameters["mixingStartTime"].as<const char *>()) : parameters["mixingStartTime"].as<long>();
    mixingStarted = parameters["mixingStarted"].is<bool>() ? parameters["mixingStarted"].as<bool>() : false;
    completedCycles = parameters["completedCycles"].is<const char *>() ? atoi(parameters["completedCycles"].as<const char *>()) : parameters["completedCycles"].as<int>();
    currentCycle = parameters["currentCycle"].is<const char *>() ? atoi(parameters["currentCycle"].as<const char *>()) : parameters["currentCycle"].as<int>();
    heatingProgressPercent = parameters["heatingProgress"].is<const char *>() ? atof(parameters["heatingProgress"].as<const char *>()) : parameters["heatingProgress"].as<float>();
    mixingProgressPercent = parameters["mixingProgress"].is<const char *>() ? atof(parameters["mixingProgress"].as<const char *>()) : parameters["mixingProgress"].as<float>();
    // Restore sample zones
    sampleZoneCount = 0;
    if (parameters["sampleZonesToMix"].is<JsonArray>())
    {
        JsonArray zones = parameters["sampleZonesToMix"].as<JsonArray>();
        for (JsonVariant val : zones)
        {
            if (val.is<int>() && sampleZoneCount < 10)
            {
                sampleZonesArray[sampleZoneCount++] = val.as<int>();
            }
        }
    }
     // --- Recovery logic for heating progress ---
    if (parameters["heatingProgress"].is<const char*>())
        heatingProgressPercent = atof(parameters["heatingProgress"].as<const char*>());
    else
        heatingProgressPercent = parameters["heatingProgress"].as<float>();

    heatingStarted = parameters["heatingStarted"].is<bool>() ? parameters["heatingStarted"].as<bool>() : false;

    // If we are recovering into a heating state and heatingStarted is true, set up the timer and remaining duration
    if ((recoveredState == "HEATING" || recoveredState == "PAUSED") && heatingStarted) {
        float percent = heatingProgressPercent;
        if (percent < 0.0f) percent = 0.0f;
        if (percent > 100.0f) percent = 100.0f;
        float totalMs = durationOfHeating * 1000.0f;
        heatingDurationRemaining = (1.0f - percent / 100.0f) * totalMs;
        heatingStartTime = millis() - (unsigned long)(percent / 100.0f * totalMs);
    }

    // --- Recovery logic for mixing progress ---
    if (parameters["mixingProgress"].is<const char*>())
        mixingProgressPercent = atof(parameters["mixingProgress"].as<const char*>());
    else
        mixingProgressPercent = parameters["mixingProgress"].as<float>();

    mixingStarted = parameters["mixingStarted"].is<bool>() ? parameters["mixingStarted"].as<bool>() : false;

    if ((recoveredState == "MIXING" || recoveredState == "PAUSED") && mixingStarted) {
        float percent = mixingProgressPercent;
        if (percent < 0.0f) percent = 0.0f;
        if (percent > 100.0f) percent = 100.0f;
        float totalMs = durationOfMixing * 1000.0f;
        mixingDurationRemaining = (1.0f - percent / 100.0f) * totalMs;
        mixingStartTime = millis() - (unsigned long)(percent / 100.0f * totalMs);
    }

    // Print recovery state for debugging
    Serial.println("[RECOVERY] Restored system state and parameters:");
    Serial.printf("  Current state: %s\n", recoveredState.c_str());
    Serial.printf("  Volume per cycle: %.2f µL\n", volumeAddedPerCycle);
    Serial.printf("  Syringe diameter: %.2f in\n", syringeDiameter);
    Serial.printf("  Heating temp: %.2f °C for %.2f s\n", desiredHeatingTemperature, durationOfHeating);
    Serial.printf("  Mixing duration: %.2f s with %d zone(s)\n", durationOfMixing, sampleZoneCount);
    Serial.printf("  Number of cycles: %d (completed: %d, current: %d)\n", numberOfCycles, completedCycles, currentCycle);
    // Serial.printf("  Syringe Step Count: %d\n", syringeStepCount);
    Serial.printf("  HeatingStarted: %s | HeatingProgressPercent: %lu\n", heatingStarted ? "true" : "false", heatingProgressPercent);
    Serial.printf("  MixingStarted: %s | MixingProgressPercent: %lu\n", mixingStarted ? "true" : "false", mixingProgressPercent);
    sendCycleProgress();

}

/**
 * @brief Parses and applies configuration parameters from client.
 *
 * Receives parameters like syringe diameter, heating time, and sample zones.
 * Updates global configuration variables accordingly.
 *
 * @param parameters JSON object containing the configuration parameters
 */
void handleParametersPacket(const JsonObject &parameters)
{
    // Handle both string and numeric values for parameters
    volumeAddedPerCycle = parameters["volumeAddedPerCycle"].is<const char *>() ? atof(parameters["volumeAddedPerCycle"].as<const char *>()) : parameters["volumeAddedPerCycle"].as<float>();
    volumeAddedPerCycle = volumeAddedPerCycle * 12; // Change inout from total liquid to volume per vial.
    syringeDiameter = parameters["syringeDiameter"].is<const char *>() ? atof(parameters["syringeDiameter"].as<const char *>()) : parameters["syringeDiameter"].as<float>();

    desiredHeatingTemperature = parameters["desiredHeatingTemperature"].is<const char *>() ? atof(parameters["desiredHeatingTemperature"].as<const char *>()) : parameters["desiredHeatingTemperature"].as<float>();

    durationOfHeating = parameters["durationOfHeating"].is<const char *>() ? atof(parameters["durationOfHeating"].as<const char *>()) : parameters["durationOfHeating"].as<float>();
    durationOfHeating = durationOfHeating * 60; // Convert seconds to minutes

    durationOfMixing = parameters["durationOfMixing"].is<const char *>() ? atof(parameters["durationOfMixing"].as<const char *>()) : parameters["durationOfMixing"].as<float>();

    numberOfCycles = parameters["numberOfCycles"].is<const char *>() ? atoi(parameters["numberOfCycles"].as<const char *>()) : parameters["numberOfCycles"].as<int>();

    // Restore mixing zones
    sampleZoneCount = 0;
    if (parameters["sampleZonesToMix"].is<JsonArray>())
    {
        JsonArray zones = parameters["sampleZonesToMix"].as<JsonArray>();
        for (JsonVariant val : zones)
        {
            if (val.is<int>() && sampleZoneCount < 10)
            {
                sampleZonesArray[sampleZoneCount++] = val.as<int>();
            }
        }
    }

    // Print configuration summary
    Serial.println("[PARAMETERS] Parameters received and parsed.");
    Serial.printf("  Volume per cycle: %.2f µL\n", volumeAddedPerCycle);
    Serial.printf("  Syringe diameter: %.2f in\n", syringeDiameter);
    Serial.printf("  Heating temp: %.2f °C for %.2f s\n", desiredHeatingTemperature, durationOfHeating);
    Serial.printf("  Mixing duration: %.2f s with %d zone(s)\n", durationOfMixing, sampleZoneCount);
    Serial.printf("  Number of cycles: %d\n", numberOfCycles);

    // Ready the system for operation
    setState(SystemState::READY);
}
