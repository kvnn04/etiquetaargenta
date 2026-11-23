import Link from 'next/link';
import { LEGAL_ENTITY, LEGAL_LINKS, legalMetadata } from '@/lib/legal/config';
import {
  LEGAL_DATA_BUSINESS_DAYS,
  LEGAL_DATA_RIGHTS,
  LEGAL_RESPONSE_HOURS,
} from '@/lib/legal/requests';
import { readLegalPrice } from '@/lib/legal/service';
import LegalIdentity from '@/components/legal/legal-identity';
import LegalMeta from '@/components/legal/legal-meta';
import PrivacyForm from '@/components/legal/privacy-form';

/* ============================================================================
 * /privacidad — POLÍTICA DE PRIVACIDAD Y DERECHOS DE DATOS (R13.9/R13.10)
 * Pública, sin login. Ley 25.326 + Disposición 954/2025. El formulario de
 * derechos vive en la misma página (ancla #derechos) y responde en 5 días
 * hábiles. La AAIP es la autoridad de aplicación.
 * ============================================================================ */

export const dynamic = 'force-dynamic';

export const metadata = legalMetadata({
  title: 'Política de Privacidad',
  description:
    'Qué datos trata el Simulador Mates, para qué, con quién se comparten, cuánto se conservan y cómo ejercer tus derechos de acceso, rectificación, supresión y oposición (Ley 25.326).',
  path: LEGAL_LINKS.privacy,
});

export default async function PrivacyPage() {
  const price = await readLegalPrice();

  return (
    <article className="legal-prose">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.24em] text-gold-soft">Legal</p>
        <h1 className="mt-1 text-2xl font-bold text-cream sm:text-3xl">Política de Privacidad</h1>
        <LegalMeta document="privacy" />
        <p className="mt-4 text-xs leading-relaxed text-stone-400">
          Esta política explica cómo {LEGAL_ENTITY.name} trata los datos personales del taller y de
          las personas que reciben sus propuestas. Se rige por la Ley 25.326 de Protección de Datos
          Personales y por la Ley 24.240 de Defensa del Consumidor.
        </p>
      </header>

      <LegalIdentity compact />

      <h2>1. Responsable del tratamiento</h2>
      <p>
        El responsable es {LEGAL_ENTITY.legalName || LEGAL_ENTITY.name}
        {LEGAL_ENTITY.cuit ? `, CUIT ${LEGAL_ENTITY.cuit}` : ''}
        {LEGAL_ENTITY.address ? `, con domicilio en ${LEGAL_ENTITY.address}` : ''}. Las consultas
        sobre datos personales se reciben por el canal publicado en el bloque de identidad y por el
        formulario de derechos de esta página. La base de datos está inscripta o se inscribe ante
        la Agencia de Acceso a la Información Pública (AAIP) conforme al artículo 21 de la Ley
        25.326.
      </p>

      <h2>2. Qué datos tratamos</h2>
      <p>Tratamos únicamente los datos necesarios para operar el simulador:</p>
      <ul>
        <li>
          <strong>Cuenta:</strong> email, contraseña hasheada por Supabase Auth (nunca la vemos),
          identificador de Google si elegís OAuth, estado de verificación del email y fecha de alta.
        </li>
        <li>
          <strong>Perfil del taller:</strong> nombre del taller, nombre de marca, logo, WhatsApp,
          Instagram y ciudad/provincia que cargues voluntariamente.
        </li>
        <li>
          <strong>Trabajo:</strong> proyectos, diseños, medidas, colores, texturas SVG/PNG que
          subas, fichas generadas y enlaces comerciales publicados.
        </li>
        <li>
          <strong>Suscripción y pagos:</strong> plan, estado del ciclo, precio congelado, fechas de
          cobro, identificadores de pago/preapproval y recibos. Los datos completos de la tarjeta
          los trata Mercado Pago; la plataforma no los recibe ni los almacena.
        </li>
        <li>
          <strong>Actividad y enlaces:</strong> publicaciones, versiones congeladas, aprobaciones
          de tus clientes y eventos técnicos de uso (sin contenido del chat de WhatsApp).
        </li>
        <li>
          <strong>Solicitudes legales:</strong> nombre, email, fecha de compra, identificador de
          pago y el texto que escribas en los formularios de arrepentimiento, baja o derechos.
        </li>
        <li>
          <strong>Técnicos:</strong> dirección IP y user-agent al aceptar los términos en el
          checkout; en los formularios legales guardamos solo un hash con salt de la IP, para
          limitar abuso.
        </li>
      </ul>

      <h2>3. Para qué y con qué base legal</h2>
      <ul>
        <li>
          <strong>Ejecutar el contrato</strong> (art. 6, inc. 1, Ley 25.326): crear la cuenta,
          guardar proyectos, generar fichas, publicar enlaces, cobrar la suscripción y atender la
          baja o el arrepentimiento.
        </li>
        <li>
          <strong>Obligaciones legales:</strong> conservar evidencia de aceptación de términos,
          registrar solicitudes de consumo y responder pedidos de datos.
        </li>
        <li>
          <strong>Interés legítimo:</strong> seguridad, prevención de fraude, rate limit de los
          formularios públicos y diagnóstico técnico. No se usa para perfilado publicitario.
        </li>
        <li>
          <strong>Consentimiento:</strong> solo para comunicaciones opcionales que no sean
          transaccionales. Hoy no enviamos newsletter ni promociones.
        </li>
      </ul>

      <h2>4. Con quién se comparten</h2>
      <p>
        No vendemos datos personales. Usamos proveedores que tratan datos por cuenta nuestra y con
        contratos de tratamiento:
      </p>
      <ul>
        <li>
          <strong>Supabase:</strong> autenticación, base de datos y almacenamiento de imágenes.
        </li>
        <li>
          <strong>Vercel:</strong> hosting y logs técnicos de la aplicación.
        </li>
        <li>
          <strong>Mercado Pago:</strong> procesamiento de la suscripción y de los reembolsos; es
          responsable de los datos de tarjeta.
        </li>
        <li>
          <strong>Resend:</strong> envío de emails transaccionales (acuses, recibos, avisos de
          cobro y baja).
        </li>
        <li>
          <strong>Google:</strong> solo si elegís iniciar sesión con Google.
        </li>
      </ul>
      <p>
        Algunos proveedores pueden alojar datos fuera de Argentina (por ejemplo, Estados Unidos o
        la Unión Europea). En esos casos se aplican las garantías contractuales del proveedor y los
        estándares de la AAIP para transferencias internacionales. Los enlaces comerciales que
        publicás son visibles para quien tenga el link: no incluyas en ellos datos que no quieras
        compartir con tus clientes.
      </p>

      <h2>5. Cuánto conservamos</h2>
      <ul>
        <li>
          <strong>Cuenta y contenido:</strong> mientras la cuenta exista. Si la eliminás, la fila
          queda restaurable 30 días y después se purga, salvo respaldos técnicos acotados.
        </li>
        <li>
          <strong>Evidencia de aceptación legal:</strong> mientras la relación contractual exista
          y durante los plazos de prescripción aplicables (hasta 5 años), aunque se elimine la
          cuenta; se guarda con el email en snapshot para poder defender el consentimiento.
        </li>
        <li>
          <strong>Solicitudes legales:</strong> hasta 5 años desde su resolución, por trazabilidad
          de consumo y datos.
        </li>
        <li>
          <strong>Datos de pago:</strong> según los plazos contables e impositivos (hasta 10 años
          para comprobantes).
        </li>
        <li>
          <strong>Logs técnicos:</strong> 90 días como máximo; el hash de IP de los formularios se
          conserva junto con la solicitud, no la IP cruda.
        </li>
      </ul>

      <h2>6. Cookies y almacenamiento local</h2>
      <p>
        Usamos cookies estrictamente necesarias para mantener la sesión (Supabase Auth) y
        preferencias del editor. No usamos cookies publicitarias ni de seguimiento de terceros. El
        autoguardado del proyecto puede usar almacenamiento local del navegador para no perder
        trabajo; podés borrarlo desde la configuración del navegador.
      </p>

      <h2>7. Seguridad</h2>
      <p>
        La aplicación usa HTTPS, claves de servicio solo del lado servidor, políticas de acceso por
        fila en la base y verificación de titularidad antes de cancelar una suscripción. Ningún
        sistema es infalible: si detectamos un incidente que afecte datos personales, lo notificamos
        a la AAIP y a las personas afectadas conforme a la normativa vigente.
      </p>

      <h2 id="derechos">8. Tus derechos</h2>
      <p>
        Podés ejercer en cualquier momento los derechos de <strong>acceso</strong>,{' '}
        <strong>rectificación</strong>, <strong>supresión</strong> y <strong>oposición</strong>{' '}
        previstos en la Ley 25.326. El pedido es gratuito, no requiere login y se responde dentro de{' '}
        <strong>{LEGAL_DATA_BUSINESS_DAYS} días hábiles</strong>. Para el derecho de supresión, si
        pedís el borrado de la cuenta se aplica el flujo de eliminación con 30 días de restauración;
        la evidencia legal que la ley obliga a conservar se mantiene por separado.
      </p>
      <p>
        Si la respuesta no te conforma, podés presentarte ante la{' '}
        <a href={LEGAL_LINKS.aaip} target="_blank" rel="noopener noreferrer">
          Agencia de Acceso a la Información Pública (AAIP)
        </a>
        , autoridad de aplicación de la Ley 25.326. La AAIP tiene un canal de denuncias y una
        dirección de protección de datos publicada en su sitio.
      </p>

      <div
        id="formulario-derechos"
        className="not-prose my-6 rounded-2xl border border-gold/25 bg-panel/70 p-4 sm:p-5"
      >
        <h2 className="text-base font-bold text-cream">Ejercer un derecho de datos</h2>
        <p className="mt-1 text-xs leading-relaxed text-stone-400">
          Completá el formulario y recibí un código <span className="font-mono">PRIV-…</span> en
          pantalla. No hace falta contar el motivo de tu baja ni datos de tarjeta.
        </p>
        <div className="mt-4">
          <PrivacyForm contactEmail={LEGAL_ENTITY.email} />
        </div>
      </div>

      <h2>9. Menores de edad</h2>
      <p>
        El servicio es para mayores de 18 años. No recolectamos datos de menores de forma
        consciente. Si detectamos una cuenta de un menor, la damos de baja y eliminamos los datos
        asociados.
      </p>

      <h2>10. Cambios a esta política</h2>
      <p>
        Podemos actualizar esta política por cambios legales o técnicos. Publicamos la versión y la
        fecha de vigencia al inicio. Si el cambio es material, el próximo checkout pide aceptar la
        versión nueva; las aceptaciones anteriores se conservan como evidencia y no se corta el
        acceso existente por no re-aceptar.
      </p>

      <h2>11. Contacto</h2>
      <p>
        Para consultas sobre esta política, escribinos al canal publicado en el bloque de identidad
        o usá el formulario de derechos de esta página. Respondemos dentro de{' '}
        {LEGAL_RESPONSE_HOURS} horas las solicitudes de consumo y dentro de {LEGAL_DATA_BUSINESS_DAYS}{' '}
        días hábiles las de datos personales. El horario de atención electrónica es el informado en
        el pie de página.
      </p>

      <p className="legal-note">
        Versión 1.0 publicada el 23 de noviembre de 2026.
        {price?.label ? ` El Plan PRO se ofrece por ${price.label}, impuestos incluidos.` : ''} La
        versión publicable se revisa con asesoría legal antes del go-live.
      </p>
    </article>
  );
}
