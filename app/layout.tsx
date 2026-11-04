import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Simulador 3D de Mates — MOCAP',
  description:
    'Simulador 3D para talleres de grabado láser: configurá el mate, lo compartís con tu cliente y cerrás la venta.',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen antialiased">{children}</body>
    </html>
  );
}
