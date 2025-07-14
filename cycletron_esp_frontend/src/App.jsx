import React, { useEffect, useState, useRef } from 'react';
import 'bulma/css/bulma.min.css';
import { useWebSocket } from './context/WebSocketContext';
import './App.css';

// Constants
const TAB_WIDTH = 690;
const INITIAL_PARAMETERS = {
  volumeAddedPerCycle: '',
  syringeDiameter: '',
  desiredHeatingTemperature: '',
  durationOfHeating: '',
  sampleZonesToMix: [],
  durationOfMixing: '',
  numberOfCycles: '',
};

const parameterFields = [
  { label: "Volume Added Per Cycle (uL)", key: "volumeAddedPerCycle", placeholder: "e.g., 10" },
  { label: "Syringe Diameter (in)", key: "syringeDiameter", placeholder: "e.g., 5" },
  { label: "Desired Heating Temperature (°C)", key: "desiredHeatingTemperature", placeholder: "e.g., 90" },
  { label: "Duration of Heating (minutes)", key: "durationOfHeating", placeholder: "e.g., 2" },
  { label: "Duration of Mixing (seconds)", key: "durationOfMixing", placeholder: "e.g., 15" },
  { label: "Number of Cycles", key: "numberOfCycles", placeholder: "e.g., 5" },
];

const buttonConfigs = [
  { id: 'startCycle', label: 'Start Cycle' },
  { id: 'pauseCycle', label: 'Pause Cycle' },
  { id: 'endCycle', label: 'End Cycle' },
  { id: 'extract', label: 'Extract (Pause/Continue)' },
  { id: 'refill', label: 'Refill Syringe (Pause/Continue)' },
  { id: 'logCycle', label: 'Log Cycle' },
];

function ParameterInput({ label, value, placeholder, onChange }) {
  return (
    <div className="column is-half">
      <div className="field">
        <label className="label">{label}</label>
        <div className="control">
          <input
            type="number"
            className="input is-small"
            placeholder={placeholder}
            value={value}
            onChange={onChange}
            min="0"
          />
        </div>
      </div>
    </div>
  );
}

function ControlButton({ id, label, active, disabled, onClick, isPaused }) {
  const buttonLabel = id === 'pauseCycle' && isPaused ? 'Resume Cycle' : label;
  const buttonClass = id === 'pauseCycle' && isPaused ? 'is-success' : active ? 'is-success' : 'is-light';

  return (
    <button
      className={`button ${buttonClass} m-2`}
      disabled={disabled}
      onClick={() => onClick(id)}
    >
      {buttonLabel}
    </button>
  );
}

function App() {
  const {
    espOnline,
    recoveryState,
    currentTemp,
    currentState,
    systemErrors,
    syringeStatus,
    espOutputs,
    setEspOutputs,
    sendParameters,
    sendButtonCommand,
    sendRecoveryUpdate,
    sendRecoveryUpdateSync,
    resetRecoveryState,
    clearSystemErrors,
    resetSyringeStatus,
  } = useWebSocket();

  const [parameters, setParameters] = useState(INITIAL_PARAMETERS);
  const [activeTab, setActiveTab] = useState('parameters');
  const [cycleState, setCycleState] = useState('idle');
  const [activeButton, setActiveButton] = useState(null);
  const [isPaused, setIsPaused] = useState(false);
  const [showVialSetup, setShowVialSetup] = useState(true);
  const [vialSetupStep, setVialSetupStep] = useState('prompt');
  const [showRefillPopup, setShowRefillPopup] = useState(false);
  const [serverIP, setServerIP] = useState('localhost:5175');
  const [cycleStartTimestamp, setCycleStartTimestamp] = useState(null);
  
  // Countdown timer state
  const [countdownTime, setCountdownTime] = useState(0); // in seconds
  const [isCountdownActive, setIsCountdownActive] = useState(false);
  const [countdownStartTime, setCountdownStartTime] = useState(null);
  const [countdownPausedTime, setCountdownPausedTime] = useState(0); // accumulated paused time
  
  // Use a ref to track the exact countdown time for pausing
  const countdownTimeRef = useRef(0);
  const isCountdownActiveRef = useRef(false);

  // Fetch server IP on component mount
  useEffect(() => {
    fetch('/api/serverIP')
      .then((res) => res.json())
      .then((data) => {
        if (data && data.serverAddress) {
          setServerIP(data.serverAddress);
        }
      })
      .catch((err) => {
        console.error('Failed to fetch server IP:', err);
      });
  }, []);

  // Restore UI state from recoveryState
  useEffect(() => {
    if (recoveryState) {
      setParameters(recoveryState.parameters || INITIAL_PARAMETERS);
      setActiveTab(recoveryState.activeTab || 'parameters');
      setCycleState(recoveryState.cycleState || 'idle');
      setActiveButton(recoveryState.activeButton || null);
      setCycleStartTimestamp(recoveryState.cycleStartTimestamp || null);
      setVialSetupStep(
        recoveryState.vialSetupStep !== undefined
          ? recoveryState.vialSetupStep
          : 'prompt'
      );
      // Restore isPaused based on cycleState or activeButton
      setIsPaused(
        recoveryState.cycleState === 'paused' ||
        recoveryState.activeButton === 'pauseCycle'
      );
      
      // Restore countdown timer state
      if (recoveryState.countdownTime !== undefined) {
        const savedCountdownTime = recoveryState.countdownTime;
        const wasActive = recoveryState.isCountdownActive;
        const savedStartTime = recoveryState.countdownStartTime;
        const savedPausedTime = recoveryState.countdownPausedTime || 0;
        const pauseStartTime = recoveryState.pauseStartTime;
        
        // If the countdown was active, we need to calculate how much time has passed
        // and adjust the remaining time accordingly, accounting for paused time
        if (wasActive && savedStartTime && savedCountdownTime > 0) {
          const now = Date.now();
          const totalElapsedSinceStart = Math.floor((now - savedStartTime) / 1000);
          const activeElapsedTime = totalElapsedSinceStart - savedPausedTime;
          const adjustedCountdownTime = Math.max(0, savedCountdownTime - activeElapsedTime);
          
          setCountdownTime(adjustedCountdownTime);
          setIsCountdownActive(adjustedCountdownTime > 0); // Only active if time remaining
        } else if (!wasActive && pauseStartTime && savedCountdownTime > 0) {
          // Timer was paused - we need to account for the time spent paused since last save
          const now = Date.now();
          const additionalPausedTime = Math.floor((now - pauseStartTime) / 1000);
          const totalPausedTime = savedPausedTime + additionalPausedTime;
          
          // Update the paused time but keep countdown time as-is since it was paused
          setCountdownTime(savedCountdownTime);
          setIsCountdownActive(false);
          setCountdownPausedTime(totalPausedTime);
        } else {
          // Timer was paused or finished, restore as-is
          setCountdownTime(savedCountdownTime);
          setIsCountdownActive(wasActive && savedCountdownTime > 0);
          setCountdownPausedTime(savedPausedTime);
        }
        
        setCountdownStartTime(savedStartTime);
      }
    }
  }, [recoveryState]);

  // Whenever vialSetupStep changes, persist it in recovery state
  useEffect(() => {
    if (recoveryState && recoveryState.vialSetupStep !== vialSetupStep) {
      sendRecoveryUpdate({ vialSetupStep });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vialSetupStep]);

  // Listen for ESP32 endOfCycles events
  useEffect(() => {
    const handleEspEndOfCycles = (event) => {
      console.log('Received ESP32 endOfCycles event:', event.detail);
      
      // Calculate timing information for the automatic log
      const endTimestamp = new Date().toISOString();
      let totalDurationMs = 0;
      let totalDurationFormatted = 'N/A';
      
      if (cycleStartTimestamp) {
        totalDurationMs = new Date(endTimestamp) - new Date(cycleStartTimestamp);
        const hours = Math.floor(totalDurationMs / (1000 * 60 * 60));
        const minutes = Math.floor((totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
        const seconds = Math.floor((totalDurationMs % (1000 * 60)) / 1000);
        totalDurationFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
      }
      
      // Call handleLogCycle and then handleEndCycle directly
      // Exclude extractionReady from espOutputs (syringeLeft is calculated, so no need to exclude)
      const { extractionReady, ...filteredEspOutputs } = espOutputs;
      sendButtonCommand('logCycle', true, {
        parameters,
        espOutputs: filteredEspOutputs,
        timestamp: endTimestamp,
        cycleStartTimestamp: cycleStartTimestamp,
        totalDurationMs: totalDurationMs,
        totalDurationFormatted: totalDurationFormatted,
      });
      
      // Wait a moment for the log to complete, then end the cycle
      setTimeout(() => {
        // Reset countdown timer
        setCountdownTime(0);
        setIsCountdownActive(false);
        setCountdownStartTime(null);
        setCountdownPausedTime(0);
        
        sendButtonCommand('endCycle', true); // Send 'on' to the server
        setCycleState('idle'); // Reset the cycle state to 'idle'
        setActiveButton(null); // Reset the active button
        setIsPaused(false); // Ensure the paused state is reset
        setCycleStartTimestamp(null); // Reset the cycle start timestamp
        sendRecoveryUpdate({
          parameters,
          machineStep: 'idle',
          cycleState: 'idle',
          lastAction: 'endCycle',
          progress: 0,
          activeTab: 'parameters',
          cycleStartTimestamp: null, // Clear timestamp in recovery state
          countdownTime: 0,
          isCountdownActive: false,
          countdownStartTime: null,
          countdownPausedTime: 0,
        });
        setVialSetupStep('prompt'); // Reset the vial setup step
        setShowVialSetup(true); // Show the vial setup prompt again
        setActiveTab('parameters'); // Switch to the "Set Parameters" tab
      }, 500);
    };

    window.addEventListener('espEndOfCycles', handleEspEndOfCycles);

    return () => {
      window.removeEventListener('espEndOfCycles', handleEspEndOfCycles);
    };
  }, [espOutputs, parameters, sendButtonCommand, sendRecoveryUpdate, setCycleState, setActiveButton, setIsPaused, setVialSetupStep, setShowVialSetup, setActiveTab, cycleStartTimestamp]);

  // Countdown timer logic - using a single persistent interval
  useEffect(() => {
    let interval = null;
    let saveInterval = null;
    
    // Start interval when countdown becomes active for the first time
    if (isCountdownActive) {
      interval = setInterval(() => {
        // Only decrement if the timer is still active (check the ref for immediate updates)
        if (isCountdownActiveRef.current && countdownTimeRef.current > 0) {
          const newTime = countdownTimeRef.current - 1;
          countdownTimeRef.current = newTime; // Update ref immediately
          setCountdownTime(newTime); // Update state
          
          if (newTime <= 0) {
            setIsCountdownActive(false);
            isCountdownActiveRef.current = false;
          }
        }
      }, 1000);
      
      // Save countdown state every 10 seconds while active for recovery purposes
      saveInterval = setInterval(() => {
        if (isCountdownActiveRef.current && countdownTimeRef.current > 0) {
          sendRecoveryUpdate({
            countdownTime: countdownTimeRef.current,
            isCountdownActive: true,
            countdownStartTime: countdownStartTime,
            countdownPausedTime: countdownPausedTime,
            lastSavedAt: Date.now(),
          });
        }
      }, 10000); // Save every 10 seconds
    }
    
    return () => {
      if (interval) clearInterval(interval);
      if (saveInterval) clearInterval(saveInterval);
    };
  }, [isCountdownActive]); // Only depend on isCountdownActive to avoid restarting interval
  
  // Keep the refs in sync with the state
  useEffect(() => {
    countdownTimeRef.current = countdownTime;
  }, [countdownTime]);
  
  useEffect(() => {
    isCountdownActiveRef.current = isCountdownActive;
  }, [isCountdownActive]);

  // Calculate total experiment time based on parameters
  const calculateExperimentTime = () => {
    const heatingMinutes = parseFloat(parameters.durationOfHeating) || 0;
    const mixingSeconds = parseFloat(parameters.durationOfMixing) || 0;
    const cycles = parseInt(parameters.numberOfCycles) || 0;
    
    // Convert everything to seconds
    const heatingSecondsPerCycle = heatingMinutes * 60;
    const totalSecondsPerCycle = heatingSecondsPerCycle + mixingSeconds;
    
    return totalSecondsPerCycle * cycles;
  };

  // Format time in HH:MM:SS format
  const formatTime = (totalSeconds) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    
    return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
  };

  const handleParameterChange = (key, value) => {
    if (value === '' || Number(value) >= 0) {
      setParameters((prev) => ({ ...prev, [key]: value }));
    }
  };

  const handleZoneToggle = (zone) => {
    const isSelected = parameters.sampleZonesToMix.includes(zone);
    const updatedZones = isSelected
      ? parameters.sampleZonesToMix.filter((z) => z !== zone)
      : [...parameters.sampleZonesToMix, zone];
    setParameters((prev) => ({ ...prev, sampleZonesToMix: updatedZones }));
  };

  const handleGoButton = () => {
    sendParameters(parameters); // Send parameters to the ESP32
    sendRecoveryUpdate({
      // ...parameters, // Add all parameters to recovery state
      parameters,
      machineStep: 'idle',
      lastAction: 'setParameters',
      progress: 0,
      activeTab: 'controls', // Update the active tab in recovery state
    });
    setCycleState('idle');
    setActiveTab('controls'); // Switch to the controls tab
  };

  const handleStartCycle = () => {
    const startTimestamp = new Date().toISOString();
    setCycleStartTimestamp(startTimestamp);
    
    // Start countdown timer
    const totalTime = calculateExperimentTime();
    setCountdownTime(totalTime);
    setIsCountdownActive(true);
    setCountdownStartTime(Date.now());
    setCountdownPausedTime(0);
    
    // Also update the refs
    countdownTimeRef.current = totalTime;
    isCountdownActiveRef.current = true;
    
    sendButtonCommand('startCycle', true);
    setCycleState('started');
    setActiveButton(null);
    sendRecoveryUpdate({
      machineStep: 'started',
      cycleState: 'started', // <-- important!
      lastAction: 'startCycle',
      progress: 0,
      cycleStartTimestamp: startTimestamp, // Store in recovery state too
      countdownTime: totalTime,
      isCountdownActive: true,
      countdownStartTime: Date.now(),
      countdownPausedTime: 0,
      lastSavedAt: Date.now(), // Add timestamp for recovery calculation
    });
  };

  const handlePauseCycle = async () => {
    const isPausing = !isPaused;
    const now = Date.now();
    
    if (isPausing) {
      // Pausing - immediately stop the timer and preserve exact time
      isCountdownActiveRef.current = false; // Stop timer immediately
      setIsCountdownActive(false);
      
      await sendRecoveryUpdateSync({
        parameters,
        machineStep: 'paused',
        cycleState: 'paused',
        lastAction: 'pauseCycle',
        activeButton: 'pauseCycle',
        activeTab,
        countdownTime: countdownTimeRef.current, // Use exact current time from ref
        isCountdownActive: false,
        countdownStartTime: countdownStartTime,
        countdownPausedTime: countdownPausedTime,
        pauseStartTime: now,
        lastSavedAt: now,
      });
    } else {
      // Resuming - restart timer with preserved time
      isCountdownActiveRef.current = true; // Start timer immediately
      setIsCountdownActive(true);
      
      const pauseStartTime = recoveryState?.pauseStartTime || now;
      const pauseDuration = Math.floor((now - pauseStartTime) / 1000);
      const newTotalPausedTime = countdownPausedTime + pauseDuration;
      setCountdownPausedTime(newTotalPausedTime);
      
      await sendRecoveryUpdateSync({
        parameters,
        machineStep: 'started',
        cycleState: 'started',
        lastAction: 'started',
        activeButton: null,
        activeTab,
        countdownTime: countdownTimeRef.current, // Use exact preserved time
        isCountdownActive: true,
        countdownStartTime: countdownStartTime,
        countdownPausedTime: newTotalPausedTime,
        pauseStartTime: null,
        lastSavedAt: now,
      });
    }
    
    sendButtonCommand('pauseCycle', isPausing);
    setCycleState(isPausing ? 'paused' : 'started');
    setIsPaused(isPausing);
    setActiveButton(isPausing ? 'pauseCycle' : null);
  };

  const handleEndCycle = () => {
    // Automatically log the cycle before ending
    handleLogCycle();
    
    // Reset countdown timer
    setCountdownTime(0);
    setIsCountdownActive(false);
    setCountdownStartTime(null);
    setCountdownPausedTime(0);
    
    sendButtonCommand('endCycle', true); // Send 'on' to the server
    setCycleState('idle'); // Reset the cycle state to 'idle'
    setActiveButton(null); // Reset the active button
    setIsPaused(false); // Ensure the paused state is reset
    setCycleStartTimestamp(null); // Reset the cycle start timestamp
    sendRecoveryUpdate({
      // ...parameters,
      parameters, // <-- add this line
      machineStep: 'idle',
      cycleState: 'idle',
      lastAction: 'endCycle',
      progress: 0,
      activeTab: 'parameters',
      cycleStartTimestamp: null, // Clear timestamp in recovery state
      countdownTime: 0,
      isCountdownActive: false,
      countdownStartTime: null,
      countdownPausedTime: 0,
    });
    // setParameters(INITIAL_PARAMETERS); // Reset parameters to initial state
    setVialSetupStep('prompt'); // Reset the vial setup step
    setShowVialSetup(true); // Show the vial setup prompt again
    setActiveTab('parameters'); // Switch to the "Set Parameters" tab
  };

  const handleExtract = async () => {
    const isCanceling = activeButton === 'extract';
    const now = Date.now();
    
    if (!isCanceling) {
      // Starting extraction - immediately stop timer and preserve exact time
      isCountdownActiveRef.current = false; // Stop timer immediately
      setIsCountdownActive(false);
      
      await sendRecoveryUpdateSync({
        parameters,
        machineStep: 'extract',
        cycleState: 'extract',
        lastAction: 'extract',
        activeButton: 'extract',
        activeTab,
        countdownTime: countdownTimeRef.current, // Use exact current time from ref
        isCountdownActive: false,
        countdownStartTime: countdownStartTime,
        countdownPausedTime: countdownPausedTime,
        pauseStartTime: now,
        lastSavedAt: now,
      });
    } else {
      // Canceling extraction - restart timer with preserved time
      isCountdownActiveRef.current = true; // Start timer immediately
      setIsCountdownActive(true);
      
      const pauseStartTime = recoveryState?.pauseStartTime || now;
      const pauseDuration = Math.floor((now - pauseStartTime) / 1000);
      const newTotalPausedTime = countdownPausedTime + pauseDuration;
      setCountdownPausedTime(newTotalPausedTime);
      
      await sendRecoveryUpdateSync({
        parameters,
        machineStep: 'started',
        cycleState: 'started',
        lastAction: 'started',
        activeButton: null,
        activeTab,
        countdownTime: countdownTimeRef.current, // Use exact preserved time
        isCountdownActive: true,
        countdownStartTime: countdownStartTime,
        countdownPausedTime: newTotalPausedTime,
        pauseStartTime: null,
        lastSavedAt: now,
      });
    }
    
    sendButtonCommand('extract', !isCanceling); // send "on" if starting, "off" if canceling
    setCycleState(isCanceling ? 'started' : 'extract');
    setActiveButton(isCanceling ? null : 'extract');
    
    // When Extract is clicked the first time (starting), set extraction ready to 'N/A' (waiting)
    // When Extract is clicked the second time (canceling), also set extraction ready back to 'N/A'
    if (!isCanceling) {
      // Starting extraction - set to waiting state
      setEspOutputs((prev) => ({
        ...prev,
        extractionReady: 'N/A'
      }));
    } else {
      // Canceling extraction - reset to default state
      setEspOutputs((prev) => ({
        ...prev,
        extractionReady: 'N/A'
      }));
    }
  };

  const handleRefill = async () => {
    const isCanceling = activeButton === 'refill';
    const now = Date.now();
    
    if (isCanceling) {
      // If canceling, resume countdown immediately
      isCountdownActiveRef.current = true; // Start timer immediately
      setIsCountdownActive(true);
      
      const pauseStartTime = recoveryState?.pauseStartTime || now;
      const pauseDuration = Math.floor((now - pauseStartTime) / 1000);
      const newTotalPausedTime = countdownPausedTime + pauseDuration;
      setCountdownPausedTime(newTotalPausedTime);
      
      sendButtonCommand('refill', false); // send "off" when canceling
      setCycleState('started');
      setActiveButton(null);
      await sendRecoveryUpdateSync({
        parameters,
        machineStep: 'started',
        cycleState: 'started',
        lastAction: 'started',
        activeButton: null,
        activeTab,
        countdownTime: countdownTimeRef.current, // Use exact preserved time
        isCountdownActive: true,
        countdownStartTime: countdownStartTime,
        countdownPausedTime: newTotalPausedTime,
        pauseStartTime: null,
        lastSavedAt: now,
      });
    } else {
      // If starting refill, show the popup first
      setShowRefillPopup(true);
    }
  };

  const handleRefillConfirm = async () => {
    // This is called when user clicks "Yes" in the refill popup
    setShowRefillPopup(false);
    
    // Immediately stop timer and preserve exact time
    isCountdownActiveRef.current = false; // Stop timer immediately
    setIsCountdownActive(false);
    
    // Reset syringe status to ready
    resetSyringeStatus();
    
    // Now send the actual refill command to ESP32
    sendButtonCommand('refill', true); // send "on" to start refilling
    setCycleState('refill');
    setActiveButton('refill');
    await sendRecoveryUpdateSync({
      parameters,
      machineStep: 'refill',
      cycleState: 'refill',
      lastAction: 'refill',
      activeButton: 'refill',
      activeTab,
      countdownTime: countdownTimeRef.current, // Use exact current time from ref
      isCountdownActive: false,
      countdownStartTime: countdownStartTime,
      countdownPausedTime: countdownPausedTime,
      pauseStartTime: Date.now(),
      lastSavedAt: Date.now(),
    });
  };

  const handleLogCycle = () => {
    const endTimestamp = new Date().toISOString();
    let totalDurationMs = 0;
    let totalDurationFormatted = 'N/A';
    
    if (cycleStartTimestamp) {
      totalDurationMs = new Date(endTimestamp) - new Date(cycleStartTimestamp);
      const hours = Math.floor(totalDurationMs / (1000 * 60 * 60));
      const minutes = Math.floor((totalDurationMs % (1000 * 60 * 60)) / (1000 * 60));
      const seconds = Math.floor((totalDurationMs % (1000 * 60)) / 1000);
      totalDurationFormatted = `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    }
    
    // Exclude extractionReady from espOutputs (syringeLeft is calculated, so no need to exclude)
    const { extractionReady, ...filteredEspOutputs } = espOutputs;
    sendButtonCommand('logCycle', true, {
      parameters,
      espOutputs: filteredEspOutputs,
      timestamp: endTimestamp,
      cycleStartTimestamp: cycleStartTimestamp,
      totalDurationMs: totalDurationMs,
      totalDurationFormatted: totalDurationFormatted,
    });
  };

  const isButtonDisabled = (id) => {
    if (id === 'startCycle' && cycleState !== 'idle') return true;
    if (id === 'endCycle' && cycleState === 'idle') return true;
    if (['pauseCycle', 'extract', 'refill'].includes(id) && cycleState === 'idle') return true;

    if (cycleState === 'paused' && id !== 'pauseCycle') return true;

    // Extract button is disabled when it's active (green) but extraction is not ready yet
    if (id === 'extract' && activeButton === 'extract' && espOutputs.extractionReady !== 'ready') return true;

    if (activeButton && activeButton !== id) return true;
    if (cycleState === 'idle' && id !== 'startCycle') return true;
    return false;
  };

  // When closing the overlay, update recovery state
  const handleVialSetupStep = (step) => {
    setVialSetupStep(step);
    sendRecoveryUpdate({ vialSetupStep: step });

    // Send vial setup packet to ESP32
    if (step === 'continue') {
      // First dialog: "Yes" to needing vial preparation
      sendButtonCommand('vialSetup', true, { state: 'yes' }); // Changed status to state
    } else if (step === null) {
      // This could be either "No" from first dialog or "Continue" from second dialog
      if (vialSetupStep === 'prompt') {
        // Coming from first dialog: "No" to vial preparation
        sendButtonCommand('vialSetup', true, { state: 'no' }); // Changed status to state
      } else {
        // Coming from second dialog: "Continue" after vial setup
        sendButtonCommand('vialSetup', true, { state: 'continue' }); // Changed status to state
      }
    }
  };

  // Function to reset both frontend and ESP recovery state and restart ESP32
  const resetRecoveryData = () => {
    // Reset both frontend and ESP recovery state using the single endpoint
    fetch('/api/resetRecoveryState', { method: 'POST' })
      .then((res) => res.json())
      .then((data) => {
        if (data.success) {
          console.log('Both Frontend_Recovery.json and ESP_Recovery.json reset');
          // After successfully resetting recovery data, restart the ESP32
          sendButtonCommand('restartESP32', true);
          console.log('ESP32 restart command sent');
          // Wait 2 seconds to ensure the restart command reaches the ESP32 before reloading
          setTimeout(() => {
            window.location.reload();
          }, 2000);
        }
      })
      .catch((err) => console.error('Failed to reset recovery state:', err));
  };

  // Handler for endOfCycles: log cycle, then end cycle
  const handleEndOfCycles = () => {
    handleLogCycle();
    setTimeout(() => {
      handleEndCycle();
    }, 500); // 500ms delay to ensure log finishes
  };

  // Store the last valid temperature value
  const lastTempRef = useRef(null);
  useEffect(() => {
    if (typeof currentTemp === 'number' && !isNaN(currentTemp)) {
      lastTempRef.current = currentTemp;
    }
  }, [currentTemp]);

  return (
    <div className="container" style={{ position: 'relative' }}>
      <h1 className="title is-2">Wet-Dry Cycler Interface</h1>
      
      <div className="mb-3">
        <span className="has-text-weight-semibold">Server IP: </span>
        <span className="has-text-link">{serverIP}</span>
      </div>

      <div className="mb-4">
        <span className="tag is-medium" style={{ backgroundColor: espOnline ? 'green' : 'red' }}></span>
        <span className="ml-2">
          ESP32 Status: <strong>{espOnline ? 'Connected' : 'Disconnected'}</strong>
        </span>
      </div>

      <div className="columns">
        <div className="column is-three-quarters" style={{ position: 'relative' }}>
          {/* Vial Setup Overlay - now only covers the tabs/box area */}
          {vialSetupStep && (
            <div
              style={{
                position: 'absolute',
                zIndex: 1000,
                top: 0,
                left: 0,
                width: TAB_WIDTH,
                maxWidth: '100%',
                height: '100%',
                background: 'rgba(255,255,255,0.98)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
              }}
            >
              <h1 className="title is-2 mb-5">Vial Setup</h1>
              {vialSetupStep === 'prompt' ? (
                <>
                  <h2 className="title is-4 mb-5">Need to Prepare Vials?</h2>
                  <div>
                    <button
                      className="button is-primary is-large mr-4"
                      style={{ fontSize: '2rem', padding: '2rem 4rem' }}
                      onClick={() => handleVialSetupStep('continue')}
                    >
                      Yes
                    </button>
                    <button
                      className="button is-light is-large"
                      style={{ fontSize: '2rem', padding: '2rem 4rem' }}
                      onClick={() => handleVialSetupStep(null)}
                    >
                      No
                    </button>
                  </div>
                </>
              ) : (
                <button
                  className="button is-primary is-large"
                  style={{ fontSize: '2rem', padding: '2rem 4rem' }}
                  onClick={() => handleVialSetupStep(null)}
                >
                  Continue
                </button>
              )}
            </div>
          )}

          {/* Refill Syringe Popup */}
          {showRefillPopup && (
            <div
              style={{
                position: 'absolute',
                zIndex: 1000,
                top: 0,
                left: 0,
                width: TAB_WIDTH,
                maxWidth: '100%',
                height: '100%',
                background: 'rgba(255,255,255,0.98)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'auto',
                padding: '2rem',
              }}
            >
              <h1 className="title is-3 mb-4">Refill Syringe Instructions</h1>
              <div className="content has-text-left mb-5" style={{ maxWidth: '500px' }}>
                <p className="mb-3"><strong>Before replacing the syringe make sure you:</strong></p>
                <ol>
                  <li>Close the leur lock valve</li>
                  <li>Unscrew the 2 nuts securing the syringe</li>
                  <li>Completely remove the syringe from the system</li>
                  <li>Place a full syringe in it's place</li>
                  <li>Return Syringe to it's secured position</li>
                </ol>
              </div>
              <button
                className="button is-primary is-large"
                style={{ fontSize: '1.5rem', padding: '1rem 3rem' }}
                onClick={handleRefillConfirm}
              >
                Yes
              </button>
            </div>
          )}

          <div className="tabs is-toggle is-fullwidth" style={{ maxWidth: TAB_WIDTH }}>
            <ul>
              <li className={activeTab === 'parameters' ? 'is-active' : ''}>
                <a
                  onClick={() => setActiveTab('parameters')}
                  style={{ pointerEvents: cycleState !== 'idle' ? 'none' : 'auto', opacity: cycleState !== 'idle' ? 0.5 : 1 }}
                >
                  Set Parameters
                </a>
              </li>
              <li className={activeTab === 'controls' ? 'is-active' : ''}>
                <a
                  onClick={() => setActiveTab('controls')}
                  style={{ pointerEvents: cycleState === 'idle' ? 'none' : 'auto', opacity: cycleState === 'idle' ? 0.5 : 1 }}
                >
                  Controls
                </a>
              </li>
            </ul>
          </div>

          <div className="box" style={{ maxWidth: TAB_WIDTH }}>
            {activeTab === 'parameters' && (
              <section className="mt-4">
                <div className="columns is-multiline">
                  {parameterFields.map(({ label, key, placeholder }) => (
                    <ParameterInput
                      key={key}
                      label={label}
                      value={parameters[key]}
                      placeholder={placeholder}
                      onChange={(e) => handleParameterChange(key, e.target.value)}
                    />
                  ))}

                  <div className="column is-half">
                    <div className="field">
                      <label className="label">Sample Zones to Mix</label>
                      <div className="control">
                        {[1, 2, 3].map((zone) => (
                          <label key={zone} className="checkbox mr-3">
                            <input
                              type="checkbox"
                              className="mr-2"
                              checked={parameters.sampleZonesToMix.includes(zone)}
                              onChange={() => handleZoneToggle(zone)}
                            />
                            {`Zone${zone}`}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>

                <div className="field">
                  <div className="control">
                    <button className="button is-primary" onClick={handleGoButton}>
                      Go
                    </button>
                  </div>
                </div>
              </section>
            )}

            {activeTab === 'controls' && (
              <section className="mt-4">
                <div className="buttons are-medium is-flex is-flex-wrap-wrap is-justify-content-space-between">
                  {buttonConfigs.map(({ id, label }) => (
                    <ControlButton
                      key={id}
                      id={id}
                      label={id === 'pauseCycle' && isPaused ? 'Resume Cycle' : label}
                      active={activeButton === id}
                      disabled={isButtonDisabled(id)}
                      onClick={(btnId) => {
                        if (btnId === 'startCycle') handleStartCycle();
                        else if (btnId === 'pauseCycle') handlePauseCycle();
                        else if (btnId === 'endCycle') handleEndCycle();
                        else if (btnId === 'extract') handleExtract();
                        else if (btnId === 'refill') handleRefill();
                        else if (btnId === 'logCycle') handleLogCycle();
                        else sendButtonCommand(btnId);
                      }}
                      isPaused={isPaused} // Pass the isPaused state
                    />
                  ))}
                </div>
              </section>
            )}
          </div>
        </div>

        <div className="column is-one-quarter">
          <div className="box" style={{ maxWidth: 400 }}>
            <h2 className="title is-5">ESP32 Outputs</h2>
            
            {/* Countdown Timer - only show when experiment is running */}
            {(cycleState === 'started' || cycleState === 'paused' || cycleState === 'extract' || cycleState === 'refill') && (
              <div className="column is-full mb-4">
                <div className="box has-background-info-light">
                  <label className="label is-small">Experiment Completion Time</label>
                  <div className="field">
                    <div className="control">
                      <input
                        type="text"
                        className="input is-small has-text-weight-bold has-text-centered"
                        value={formatTime(countdownTime)}
                        readOnly
                        style={{
                          backgroundColor: countdownTime <= 300 ? '#ffdd57' : // Yellow when 5 min or less
                                         countdownTime <= 60 ? '#ff3860' : // Red when 1 min or less
                                         '#48c78e', // Green otherwise
                          color: countdownTime <= 60 ? 'white' : 'black',
                          fontSize: '1.2rem'
                        }}
                      />
                    </div>
                  </div>
                  <p className="is-size-7 has-text-centered">
                    {!isCountdownActive && countdownTime > 0 ? 'Timer Paused' : 'Time Remaining'}
                  </p>
                </div>
              </div>
            )}
            
            <div className="columns is-full is-multiline">
              <div className="column is-full">
                <label className="label is-small">Current ESP32 State</label>
                <div className="field">
                  <div className="control">
                    <input
                      type="text"
                      className="input is-small"
                      value={currentState || 'UNKNOWN'}
                      readOnly
                      style={{
                        backgroundColor: currentState === 'UNKNOWN' ? '#ffdd57' : 
                                       currentState === 'ERROR' ? '#ff3860' :
                                       currentState === 'IDLE' ? '#dbdbdb' :
                                       currentState === 'READY' ? '#48c78e' :
                                       '#3298dc'
                      }}
                    />
                  </div>
                </div>
              </div>
              <div className="column is-full">
                <label className="label is-small">Current State Progress</label>
                <progress 
                  className="progress is-info is-small" 
                  value={
                    currentState === 'HEATING' ? (espOutputs.heatingProgress || 0) :
                    currentState === 'MIXING' ? (espOutputs.mixingProgress || 0) :
                    currentState === 'REHYDRATING' ? 100 : // Rehydration is typically instant
                    0
                  } 
                  max="100"
                >
                  {
                    currentState === 'HEATING' ? (espOutputs.heatingProgress || 0) :
                    currentState === 'MIXING' ? (espOutputs.mixingProgress || 0) :
                    currentState === 'REHYDRATING' ? 100 :
                    0
                  }%
                </progress>
              </div>
              <div className="column is-three-quarters">
                <label className="label is-small"># Cycles Completed</label>
                <input
                    type="text"
                    className="input is-small"
                    value={
                        `${espOutputs.cyclesCompleted || 0} of ${parameters.numberOfCycles || 0} cycles completed`
                    }
                    readOnly
                />
              </div>
              <div className="column is-full">
                <label className="label is-small">Temperature Data</label>
                <input
                  type="text"
                  value={
                    (typeof lastTempRef.current === 'number' && !isNaN(lastTempRef.current))
                      ? `${lastTempRef.current.toFixed(2)} °C`
                      : 'N/A'
                  }
                  readOnly
                />
              </div>
              <div className="column is-full">
                <label className="label is-small">Syringe Status</label>
                <span
                  className="tag is-medium"
                  style={{
                    backgroundColor: syringeStatus === 'ready' ? 'green' : 'red',
                    color: 'white',
                  }}
                >
                  {syringeStatus === 'ready' ? 'Syringe Ready' : 'SYRINGE EMPTY'}
                </span>
              </div>
              <div className="column is-full">
                <label className="label is-small">Extraction Ready</label>
                <span
                  className="tag is-medium"
                  style={{
                    backgroundColor: espOutputs.extractionReady === 'ready' ? 'green' : 'red',
                    color: 'white',
                  }}
                >
                  {espOutputs.extractionReady === 'ready' ? 'Extraction Ready' : 'Not Ready'}
                </span>
              </div>


            </div>
          </div>
        </div>
      </div>

      {/* System Errors at the bottom */}
      <div style={{ position: 'relative', marginTop: '2rem' }}>
        <section className="box mt-4">
          <div className="is-flex is-align-items-center mb-2">
            <h2 className="title is-5 mb-0 mr-3" style={{ marginBottom: 0 }}>System Errors</h2>
            <button className="button is-small is-danger mr-2" onClick={resetRecoveryData}>
              Reset Recovery Data & Restart ESP32
            </button>
            {systemErrors.length > 0 && (
              <button className="button is-small is-warning" onClick={clearSystemErrors}>
                Clear Errors ({systemErrors.length})
              </button>
            )}
          </div>
          
          {/* System Errors Display */}
          {systemErrors.length > 0 ? (
            <div className="box has-background-danger-light">
              {systemErrors.map((error) => (
                <div key={error.id} className="notification is-danger is-light mb-2">
                  <div className="is-flex is-justify-content-space-between">
                    <div>
                      <strong>{error.timestamp}</strong>
                      <p>{error.message}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="box has-background-success-light">
              <p className="has-text-success has-text-weight-semibold">No system errors detected</p>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export default App;
