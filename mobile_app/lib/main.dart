import 'package:flutter/material.dart';
import 'screens/parent_radar_screen.dart';
import 'screens/child_guardian_screen.dart';

void main() {
  WidgetsFlutterBinding.ensureInitialized();
  runApp(const FamSafeApp());
}

class FamSafeApp extends StatelessWidget {
  const FamSafeApp({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'FamSafe',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xFF2563EB)),
        useMaterial3: true,
      ),
      home: const RoleSelectorScreen(),
    );
  }
}

class RoleSelectorScreen extends StatelessWidget {
  const RoleSelectorScreen({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: Colors.white,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.symmetric(horizontal: 24, vertical: 40),
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const Icon(Icons.shield_outlined, size: 72, color: Color(0xFF2563EB)),
              const SizedBox(height: 16),
              const Text(
                "FamSafe",
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 32, fontWeight: FontWeight.w900, color: Color(0xFF0F172A)),
              ),
              const SizedBox(height: 6),
              const Text(
                "Seguridad Familiar y Rastreo GPS",
                textAlign: TextAlign.center,
                style: TextStyle(fontSize: 14, color: Color(0xFF64748B)),
              ),
              const SizedBox(height: 48),

              // Button: Modo Padre / Tutor
              ElevatedButton(
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(builder: (context) => const ParentRadarScreen()),
                  );
                },
                style: ElevatedButton.styleFrom(
                  backgroundColor: const Color(0xFF2563EB),
                  foregroundColor: Colors.white,
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                  elevation: 2,
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.map_outlined),
                    SizedBox(width: 10),
                    Text("Ingresar como Padre / Tutor", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
                  ],
                ),
              ),

              const SizedBox(height: 16),

              // Button: Modo Hijo / Menor
              OutlinedButton(
                onPressed: () {
                  Navigator.push(
                    context,
                    MaterialPageRoute(
                      builder: (context) => const ChildGuardianScreen(childName: "Lucas"),
                    ),
                  );
                },
                style: OutlinedButton.styleFrom(
                  foregroundColor: const Color(0xFF0F172A),
                  side: const BorderSide(color: Color(0xFFE2E8F0), width: 2),
                  padding: const EdgeInsets.symmetric(vertical: 18),
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
                ),
                child: const Row(
                  mainAxisAlignment: MainAxisAlignment.center,
                  children: [
                    Icon(Icons.child_care, color: Color(0xFF10B981)),
                    SizedBox(width: 10),
                    Text("Configurar en Teléfono del Hijo", style: TextStyle(fontSize: 15, fontWeight: FontWeight.bold)),
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
