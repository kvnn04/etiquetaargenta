/**
 * Declaraciones ambientales del proyecto.
 * Next app-router importa CSS por efecto lateral; con TS moderno (≥6) hace
 * falta una declaración explícita de módulo para que `import './globals.css'` resuelva.
 */
declare module '*.css';
