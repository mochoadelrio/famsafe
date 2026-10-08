import 'package:flutter/material.dart';
import '../services/location_service.dart';

class ChildGuardianScreen extends StatefulWidget {
  final String childName;
  final String currentZone;

  const ChildGuardianScreen({
    super.key,
    required this.childName,
    this.currentZone = "Colegio San Martín",
  });

  @override
  State<ChildGuardianScreen> createState() => _ChildGuardianScreenState();
}

class _ChildGuardianScreenState extends State<ChildGuardianScreen> {
  bool _isSosActive = false;

  void _triggerSos() async {
    setState(() => _isSosActive = true);
    await LocationService().triggerSos(note: "SOS de emergencia disparado por ${widget.childName}");

    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        backgroundColor: Colors.red,
        content: Text(
          "🚨 ¡Alerta enviada a tus padres con tu ubicación en vivo!",
          style: TextStyle(fontWeight: FontWeight.bold),
        ),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: const Color(0xFFF8FAFC),
      appBar: AppBar(
        backgroundColor: Colors.white,
        elevation: 0,
        title: Row(
          children: [
            const Icon(Icons.shield, color: Color(0xFF2563EB)),
            const SizedBox(width: 8),
            Text(
              "FamSafe Protege a ${widget.childName}",
              style: const TextStyle(color: Color(0xFF0F172A), fontSize: 16, fontWeight: FontWeight.bold),
            ),
          ],
        ),
      ),
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 20),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              // Safe zone status
              Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(20),
                  border: Border.all(color: const Color(0xFFE2E8F0)),
                  boxShadow: [
                    BoxShadow(color: Colors.black.withOpacity(0.04), blurRadius: 10, offset: const Offset(0, 4)),
                  ],
                ),
                child: Row(
                  children: [
                    Container(
                      width: 48,
                      height: 48,
                      decoration: BoxDecoration(
                        color: const Color(0xFFECFDF5),
                        borderRadius: BorderRadius.circular(14),
                      ),
                      child: const Icon(Icons.check_circle, color: Color(0xFF10B981), size: 28),
                    ),
                    const SizedBox(width: 14),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          const Text("Estás en una Zona Segura", style: TextStyle(fontSize: 12, color: Color(0xFF64748B))),
                          const SizedBox(height: 2),
                          Text(widget.currentZone, style: const TextStyle(fontSize: 16, fontWeight: FontWeight.bold, color: Color(0xFF0F172A))),
                        ],
                      ),
                    ),
                  ],
                ),
              ),

              // Giant SOS Panic Button
              Column(
                children: [
                  GestureDetector(
                    onTap: _triggerSos,
                    child: Container(
                      width: 200,
                      height: 200,
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: const LinearGradient(
                          colors: [Color(0xFFEF4444), Color(0xFFB91C1C)],
                          begin: Alignment.topLeft,
                          end: Alignment.bottomRight,
                        ),
                        boxShadow: [
                          BoxShadow(
                            color: const Color(0xFFEF4444).withOpacity(_isSosActive ? 0.8 : 0.4),
                            blurRadius: _isSosActive ? 40 : 25,
                            spreadRadius: _isSosActive ? 10 : 4,
                          ),
                        ],
                      ),
                      child: Center(
                        child: Column(
                          mainAxisAlignment: MainAxisAlignment.center,
                          children: [
                            const Icon(Icons.warning_amber_rounded, color: Colors.white, size: 54),
                            const SizedBox(height: 6),
                            Text(
                              _isSosActive ? "ENVIADO" : "SOS",
                              style: const TextStyle(
                                color: Colors.white,
                                fontSize: 32,
                                fontWeight: FontWeight.w900,
                                letterSpacing: 2,
                              ),
                            ),
                          ],
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(height: 16),
                  const Text(
                    "Toca en caso de emergencia para avisar a tus padres",
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, color: Color(0xFF64748B), fontWeight: FontWeight.w500),
                  ),
                ],
              ),

              // Walk With Me Quick Button
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(
                  color: const Color(0xFFEEF2FF),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: const Color(0xFFC7D2FE)),
                ),
                child: Row(
                  children: [
                    const Icon(Icons.directions_walk, color: Color(0xFF4F46E5), size: 28),
                    const SizedBox(width: 12),
                    const Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text("Acompáñame a Casa", style: TextStyle(fontWeight: FontWeight.bold, color: Color(0xFF312E81), fontSize: 14)),
                          Text("Activa un trayecto protegido si vas en camino", style: TextStyle(color: Color(0xFF4338CA), fontSize: 11)),
                        ],
                      ),
                    ),
                    ElevatedButton(
                      onPressed: () {},
                      style: ElevatedButton.styleFrom(
                        backgroundColor: const Color(0xFF4F46E5),
                        foregroundColor: Colors.white,
                        elevation: 0,
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(10)),
                      ),
                      child: const Text("Iniciar", style: TextStyle(fontSize: 12, fontWeight: FontWeight.bold)),
                    )
                  ],
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}
