import 'package:flutter/material.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:latlong2/latlong.dart';
import 'package:socket_io_client/socket_io_client.dart' as IO;

class ParentRadarScreen extends StatefulWidget {
  final String circleId;
  const ParentRadarScreen({super.key, this.circleId = "circle-garcia-001"});

  @override
  State<ParentRadarScreen> createState() => _ParentRadarScreenState();
}

class _ParentRadarScreenState extends State<ParentRadarScreen> {
  late IO.Socket _socket;
  final MapController _mapController = MapController();

  List<Map<String, dynamic>> _members = [
    {
      "id": "user-lucas-child",
      "name": "Lucas",
      "role": "Hijo (9a)",
      "battery": 42,
      "location": const LatLng(40.4125, -3.7050),
      "address": "Colegio San Martín",
      "isSos": false,
    },
    {
      "id": "user-sofia-teen",
      "name": "Sofía",
      "role": "Adolescente (15a)",
      "battery": 18,
      "location": const LatLng(40.4148, -3.7082),
      "address": "Calle Mayor",
      "isSos": false,
    }
  ];

  @override
  void initState() {
    super.initState();
    _connectWebSocket();
  }

  void _connectWebSocket() {
    _socket = IO.io('https://famsafe.onrender.com', IO.OptionBuilder()
      .setTransports(['websocket'])
      .enableAutoConnect()
      .build());

    _socket.onConnect((_) {
      _socket.emit('circle:join', widget.circleId);
    });

    _socket.on('member:location_update', (data) {
      if (mounted) {
        setState(() {
          // Update member location in realtime
        });
      }
    });

    _socket.on('sos:triggered', (data) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            backgroundColor: Colors.red,
            duration: Duration(seconds: 8),
            content: Text("🚨 ¡EMERGENCIA SOS DISPARADA! Revisa el mapa inmediatamente.", style: TextStyle(fontWeight: FontWeight.bold)),
          ),
        );
      }
    });
  }

  @override
  void dispose() {
    _socket.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 1,
        title: const Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text("Familia García", style: TextStyle(color: Color(0xFF0F172A), fontSize: 16, fontWeight: FontWeight.bold)),
            Text("Sincronizado en tiempo real", style: TextStyle(color: Color(0xFF10B981), fontSize: 11, fontWeight: FontWeight.w600)),
          ],
        ),
        actions: [
          IconButton(
            icon: const Icon(Icons.my_location, color: Color(0xFF2563EB)),
            onPressed: () {
              _mapController.move(const LatLng(40.4150, -3.7060), 15.0);
            },
          ),
        ],
      ),
      body: Stack(
        children: [
          // Flutter Interactive Map
          FlutterMap(
            mapController: _mapController,
            options: const MapOptions(
              initialCenter: LatLng(40.4150, -3.7060),
              initialZoom: 15.0,
            ),
            children: [
              TileLayer(
                urlTemplate: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
                userAgentPackageName: 'com.famsafe.mobile',
              ),
              // Safe Zones Circles
              CircleLayer(
                circles: [
                  CircleMarker(
                    point: const LatLng(40.4180, -3.7040),
                    color: const Color(0xFF10B981).withOpacity(0.2),
                    borderColor: const Color(0xFF10B981),
                    borderStrokeWidth: 2,
                    useRadiusInMeter: true,
                    radius: 150,
                  ),
                  CircleMarker(
                    point: const LatLng(40.4125, -3.7050),
                    color: const Color(0xFF3B82F6).withOpacity(0.2),
                    borderColor: const Color(0xFF3B82F6),
                    borderStrokeWidth: 2,
                    useRadiusInMeter: true,
                    radius: 180,
                  ),
                ],
              ),
              // Members Markers
              MarkerLayer(
                markers: _members.map((m) {
                  return Marker(
                    point: m["location"],
                    width: 50,
                    height: 50,
                    child: Container(
                      decoration: BoxDecoration(
                        color: m["isSos"] ? Colors.red : const Color(0xFF2563EB),
                        shape: BoxShape.circle,
                        border: Border.all(color: Colors.white, width: 3),
                        boxShadow: const [BoxShadow(color: Colors.black26, blurRadius: 8)],
                      ),
                      child: Center(
                        child: Text(
                          m["name"][0],
                          style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18),
                        ),
                      ),
                    ),
                  );
                }).toList(),
              ),
            ],
          ),

          // Bottom Draggable Members Sheet
          DraggableScrollableSheet(
            initialChildSize: 0.28,
            minChildSize: 0.15,
            maxChildSize: 0.5,
            builder: (context, scrollController) {
              return Container(
                decoration: const BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
                  boxShadow: [BoxShadow(color: Colors.black12, blurRadius: 15)],
                ),
                child: ListView(
                  controller: scrollController,
                  padding: const EdgeInsets.all(16),
                  children: [
                    Center(
                      child: Container(
                        width: 40,
                        height: 4,
                        decoration: BoxDecoration(color: Colors.grey[300], borderRadius: BorderRadius.circular(2)),
                      ),
                    ),
                    const SizedBox(height: 12),
                    const Text("Integrantes del Círculo", style: TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                    const SizedBox(height: 8),
                    ..._members.map((m) {
                      return ListTile(
                        leading: CircleAvatar(
                          backgroundColor: const Color(0xFF2563EB),
                          child: Text(m["name"][0], style: const TextStyle(color: Colors.white)),
                        ),
                        title: Text(m["name"], style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 14)),
                        subtitle: Text(m["address"], style: const TextStyle(fontSize: 12)),
                        trailing: Row(
                          mainAxisSize: MainAxisSize.min,
                          children: [
                            Icon(Icons.battery_std, size: 16, color: m["battery"] <= 20 ? Colors.red : Colors.green),
                            Text("${m["battery"]}%", style: const TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                          ],
                        ),
                        onTap: () {
                          _mapController.move(m["location"], 16.5);
                        },
                      );
                    }),
                  ],
                ),
              );
            },
          ),
        ],
      ),
    );
  }
}
