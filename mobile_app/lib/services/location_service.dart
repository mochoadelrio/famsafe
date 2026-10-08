import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:flutter_background_geolocation/flutter_background_geolocation.dart' as bg;
import 'package:http/http.dart' as http;
import 'package:battery_plus/battery_plus.dart';

class LocationService {
  static final LocationService _instance = LocationService._internal();
  factory LocationService() => _instance;
  LocationService._internal();

  final Battery _battery = Battery();
  String serverUrl = "https://famsafe.onrender.com";
  String? currentMemberId;
  String? circleId;

  Future<void> initialize({required String memberId, required String circle}) async {
    currentMemberId = memberId;
    circleId = circle;

    // Background Geolocation config (Ultra-Low Battery Drain: <3% daily)
    await bg.BackgroundGeolocation.ready(bg.Config(
      desiredAccuracy: bg.Config.DESIRED_ACCURACY_HIGH,
      distanceFilter: 15.0, // Updates every 15 meters when in motion
      stopTimeout: 5, // Goes to stationary sleep mode after 5 minutes of no movement
      autoSync: true,
      stopOnTerminate: false, // Keeps running if phone is rebooted or app swiped
      startOnBoot: true,
      enableHeadless: true,
      debug: false,
      logLevel: bg.Config.LOG_LEVEL_OFF,
      notification: bg.Notification(
        title: "FamSafe Protección Activa",
        text: "Cuidando a tu familia en tiempo real",
        color: "#2563EB",
      ),
    ));

    // Listen to location events
    bg.BackgroundGeolocation.onLocation((bg.Location location) async {
      debugPrint('[GPS Telemetry] ${location.coords.latitude}, ${location.coords.longitude}');
      await _sendTelemetryToServer(location);
    });

    // Listen to stationary events (Resting in classroom/home)
    bg.BackgroundGeolocation.onMotionChange((bg.Location location) {
      debugPrint('[Motion Change] Moving: ${location.isMoving}');
    });

    // Start tracking
    await bg.BackgroundGeolocation.start();
  }

  Future<void> _sendTelemetryToServer(bg.Location location) async {
    if (currentMemberId == null) return;

    final batteryLevel = await _battery.batteryLevel;
    final batteryState = await _battery.batteryState;

    try {
      final response = await http.post(
        Uri.parse('$serverUrl/api/telemetry'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'memberId': currentMemberId,
          'lat': location.coords.latitude,
          'lng': location.coords.longitude,
          'accuracy': location.coords.accuracy,
          'speedKmh': (location.coords.speed * 3.6).roundToDouble(),
          'status': location.isMoving ? 'walking' : 'stationary',
          'battery': batteryLevel,
          'isCharging': batteryState == BatteryState.charging,
        }),
      );
      debugPrint('[Telemetry Response] ${response.statusCode}');
    } catch (e) {
      debugPrint('[Telemetry Error] $e');
    }
  }

  Future<void> triggerSos({String? note}) async {
    if (currentMemberId == null) return;

    try {
      await http.post(
        Uri.parse('$serverUrl/api/sos/trigger'),
        headers: {'Content-Type': 'application/json'},
        body: jsonEncode({
          'memberId': currentMemberId,
          'note': note ?? "¡Botón SOS pulsado desde app móvil!",
        }),
      );
    } catch (e) {
      debugPrint('[SOS Trigger Error] $e');
    }
  }
}
