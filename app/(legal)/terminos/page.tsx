import Link from 'next/link';
import { LEGAL_ENTITY, LEGAL_LINKS, legalMetadata } from '@/lib/legal/config';
import { LEGAL_WITHDRAWAL_DAYS } from '@/lib/legal/requests';
import { readLegalPrice } from '@/lib/legal/service';
import LegalIdentity from '@/components/legal/legal-identity';
import LegalMeta from '@/components/legal/legal-meta';

/* ============================================================================
 * /terminos — TÉRMINOS Y CONDICIONES (R13.1 + §3.2)
 * Pública, sin login. Contenido mínimo de 16 puntos + identidad + precio
 * dinámico de pricing_config. La norma citada es la Disposición 954/2025,
 * NO las derogadas 424/2020 ni 316/2018.
 * ============================================================================ */

export const dynamic = 'force-dynamic';

export const metadata = legalMetadata({
  title: 'Términos y Condiciones',
  description:
    'Términos y Condiciones del Simulador Mates: planes FREE y PRO, precio, renovación, cancelación, arrepentimiento, reembolsos, propiedad intelectual y jurisdicción.',
  path: LEGAL_LINKS.terms,
});

export default async function TermsPage() {
  const price = await readLegalPrice();
  const priceLabel = price?.label ?? null;

  return (
    <article className="legal-prose">
      <header>
        <p className="text-[10px] font-bold uppercase tracking-[.24em] text-gold-soft">Legal</p>
        <h1 className="mt-1 text-2xl font-bold text-cream sm:text-3xl">
          Términos y Condiciones
        </h1>
        <LegalMeta document="terms" />
        <p className="mt-4 text-xs leading-relaxed text-stone-400">
          Estos términos rigen el uso del simulador 3D de mates de {LEGAL_ENTITY.name}. Al crear
          una cuenta o contratar el Plan PRO, aceptás estas condiciones y la{' '}
          <Link href={LEGAL_LINKS.privacy}>Política de Privacidad</Link>. La norma de consumo
          aplicable es la Ley 24.240 y la Disposición 954/2025; la protección de datos se rige por
          la Ley 25.326.
        </p>
      </header>

      <LegalIdentity compact />

      <h2>1. Identidad del proveedor</h2>
      <p>
        El servicio es prestado por {LEGAL_ENTITY.legalName || LEGAL_ENTITY.name}
        {LEGAL_ENTITY.cuit ? `, CUIT ${LEGAL_ENTITY.cuit}` : ''}
        {LEGAL_ENTITY.taxCondition ? `, ${LEGAL_ENTITY.taxCondition}` : ''}
        {LEGAL_ENTITY.address ? `, con domicilio en ${LEGAL_ENTITY.address}` : ''}. El canal de
        atención, horario y área responsable están publicados en el bloque de identidad y en el
        pie de esta página. La atención es electrónica y no baja de 8 horas por día hábil
        (Disposición 954/2025, art. 6).
      </p>

      <h2>2. Objeto y aceptación</h2>
      <p>
        El proveedor otorga una licencia de uso no exclusiva, revocable y no transferible del
        Simulador Mates, una aplicación web para configurar mates, aplicar diseños y compartir
        propuestas 3D con clientes del taller. La licencia es para uso personal o comercial del
        taller y no incluye la reventa, sublicencia ni explotación del software como producto
        propio. La aceptación de estos términos es un requisito para contratar el Plan PRO; el
        Plan FREE se rige por las mismas reglas en lo que resulte aplicable.
      </p>

      <h2>3. Cuenta y registro</h2>
      <p>
        La cuenta se crea con email y contraseña o con Google. El taller es responsable de la
        confidencialidad de sus credenciales y de la actividad de su cuenta. El email se verifica
        al contratar el Plan PRO. No se permite crear cuentas con datos falsos, suplantar a
        terceros ni usar el servicio para actividades ilícitas. El servicio es para mayores de 18
        años.
      </p>

      <h2>4. Planes FREE y PRO</h2>
      <p>
        El <strong>Plan FREE</strong> es permanente y permite usar el editor con límites: un
        proyecto, un diseño y marca de agua en las salidas. El <strong>Plan PRO</strong> es mensual
        y agrega, mientras esté activo: salidas sin marca de agua, enlaces comerciales ilimitados,
        fichas en HD (PNG/PDF) y el logo del taller en la cabecera. La matriz de capacidades
        publicada en el editor es la referencia vigente.
      </p>

      <h2>5. Precio, moneda e impuestos</h2>
      <p>
        {priceLabel ? (
          <>
            El Plan PRO cuesta <strong>{priceLabel}</strong> en pesos argentinos (ARS), con
            impuestos incluidos.
          </>
        ) : (
          <>
            El precio vigente del Plan PRO se muestra antes de pagar, en pesos argentinos (ARS) y
            con impuestos incluidos; surge de la configuración del servicio.
          </>
        )}{' '}
        No hay costos ocultos. La comisión de Mercado Pago es absorbida por la plataforma y no se
        adiciona al consumidor. El precio puede cambiar para nuevas contrataciones; el suscriptor
        vigente conserva el precio congelado de su alta mientras mantenga la suscripción.
      </p>

      <h2>6. Facturación y renovación automática</h2>
      <p>
        El cobro se realiza con tarjeta a través de Mercado Pago, en pesos argentinos, con
        periodicidad mensual. La suscripción se renueva automáticamente hasta que se solicite la
        baja. El ciclo se ancla al día del primer pago y el débito se intenta en esa fecha. La
        plataforma nunca recibe ni almacena los datos completos de la tarjeta. La factura ARCA se
        emite de forma manual: si la necesitás, escribinos al canal de atención.
      </p>

      <h2>7. Cancelación y baja</h2>
      <p>
        Podés dar de baja en cualquier momento desde el{' '}
        <Link href={LEGAL_LINKS.cancellation}>Botón de Baja de Servicio</Link>, desde el Centro de
        Suscripción del Perfil o desde el Portal de Mercado Pago. La baja no exige login ni trámite
        adicional. Para evitar que un tercero cancele tu cuenta, te enviamos un link de confirmación
        al email de la cuenta, válido por 24 horas.
      </p>
      <p>
        Al confirmar la baja se cancela el débito automático y no se generan cobros posteriores.
        Podés elegir entre dos modalidades:
      </p>
      <ul>
        <li>
          <strong>Al final del ciclo:</strong> conservás el acceso PRO hasta el fin del ciclo ya
          pago y después la cuenta vuelve a FREE, sin reembolso.
        </li>
        <li>
          <strong>Baja inmediata con reembolso:</strong> devolvemos el saldo del último pago
          aprobado y el acceso PRO se desactiva en el momento. Si el pago tiene{' '}
          <strong>{LEGAL_WITHDRAWAL_DAYS} días corridos o menos</strong>, el reembolso es del 100 %.
          Después de ese plazo, devolvemos la parte proporcional a los días no usados del ciclo
          (monto pagado ÷ días del ciclo × días restantes). Si faltan menos de 24 horas para el fin
          del ciclo, no hay pago aprobado o el saldo ya fue devuelto, no corresponde reembolso: se
          cancela la renovación y el acceso sigue hasta el fin del ciclo.
        </li>
      </ul>
      <p>
        El plan solo se da de baja cuando Mercado Pago confirma el reembolso. Si el reembolso falla,
        cancelamos la renovación, mantenemos el acceso PRO hasta el fin del ciclo y reintentamos el
        reintegro. Tus proyectos, assets y enlaces guardados se conservan en todos los casos.
      </p>

      <h2>8. Arrepentimiento</h2>
      <p>
        Tenés derecho a arrepentirte dentro de los <strong>{LEGAL_WITHDRAWAL_DAYS} días corridos</strong>{' '}
        desde la celebración del contrato o la entrega, lo que ocurra último. Para el servicio
        digital, el plazo se cuenta desde el alta del plan. Usá el{' '}
        <Link href={LEGAL_LINKS.withdrawal}>Botón de Arrepentimiento</Link>: es público, no requiere
        login y recibe tu solicitud aunque la fecha informada quede fuera de plazo.
      </p>
      <p>
        Si el pago real está dentro de los {LEGAL_WITHDRAWAL_DAYS} días corridos, ejecutamos el
        arrepentimiento de forma automática: devolvemos el <strong>total del ciclo</strong>, incluso
        si usaste el simulador, y damos de baja el acceso PRO en el momento. Las renovaciones tienen
        el mismo derecho. Si el pago queda fuera de la ventana, revisamos la solicitud y respondemos
        con una decisión fundada. El reintegro se hace por el mismo medio de pago y la acreditación
        final depende de Mercado Pago y del banco emisor.
      </p>

      <h2>9. Reembolsos y contracargos</h2>
      <p>
        Los reembolsos se procesan por el mismo medio de pago. Los plazos de acreditación son los
        de Mercado Pago y el banco emisor; no prometemos plazos bancarios que no controlamos. Si
        iniciás un contracargo, podés contactarnos para resolverlo antes de que avance. Los
        reembolsos y contracargos no limitan los derechos que la ley reconoce al consumidor.
      </p>

      <h2>10. Propiedad intelectual</h2>
      <p>
        El software, los modelos 3D, el catálogo, los textos y la marca del SaaS son del proveedor
        o de sus licenciantes. El diseño cargado y el logo del taller son del taller. No se cede
        ningún derecho sobre el software por el uso del servicio.
      </p>

      <h2>11. Contenido del usuario</h2>
      <p>
        Al cargar un diseño, un logo o una imagen, otorgás al proveedor una licencia limitada para
        almacenarlo, renderizarlo y compartirlo con los destinatarios que vos elijas, con la única
        finalidad de prestar el servicio. Garantizás que tenés derechos sobre el material que
        cargás. No cargues contenido de terceros sin autorización ni material ilícito.
      </p>

      <h2>12. Disponibilidad y conservación</h2>
      <p>
        Hacemos esfuerzos razonables para mantener el servicio disponible, pero no prometemos un
        100 % ininterrumpido: puede haber mantenimiento o fallas de proveedores. Si bajás a FREE,
        se conservan proyectos, assets y enlaces según las reglas del producto. Si eliminás tu
        cuenta, se aplica el flujo de 30 días de restauración y luego la purga, salvo la evidencia
        legal que corresponda conservar.
      </p>

      <h2>13. Límites de responsabilidad</h2>
      <p>
        En la medida permitida por la ley, el proveedor no responde por daños indirectos,
        lucro cesante o pérdida de oportunidades derivados del uso del simulador. Nada en estos
        términos limita los derechos irrenunciables del consumidor ni la responsabilidad por dolo
        o culpa grave. El taller es responsable de la verificación comercial del diseño antes de
        producir y entregar el producto a su cliente.
      </p>

      <h2>14. Cambios y versionado</h2>
      <p>
        Podemos actualizar estos términos por cambios legales, técnicos o comerciales. Publicamos
        la versión y la fecha de vigencia en esta página. Si el cambio es material (precio,
        cancelación, datos o jurisdicción), la próxima contratación o el próximo checkout te pide
        aceptar la versión nueva. No se corta el acceso existente por no re-aceptar. Las
        aceptaciones anteriores se conservan como evidencia.
      </p>

      <h2>15. Jurisdicción y ley aplicable</h2>
      <p>
        Estos términos se rigen por la ley argentina. Las controversias de consumo se someten a
        los tribunales del domicilio del consumidor. Si el consumidor reside fuera de Argentina,
        se aplican las normas imperativas de protección que correspondan y la ley argentina en lo
        no contradictorio. Antes de iniciar un reclamo judicial, podés usar el canal de atención y
        la Defensa del Consumidor.
      </p>

      <h2>16. Contacto y reclamos</h2>
      <p>
        Para consultas, reclamos o ejercicio de derechos, usá el canal publicado en el bloque de
        identidad, el <Link href={LEGAL_LINKS.withdrawal}>Botón de Arrepentimiento</Link>, el{' '}
        <Link href={LEGAL_LINKS.cancellation}>Botón de Baja</Link> o el{' '}
        <Link href={LEGAL_LINKS.privacyRights}>formulario de derechos de datos</Link>. También podés
        presentar un reclamo ante la{' '}
        <a
          href={LEGAL_LINKS.consumerDefense}
          target="_blank"
          rel="noopener noreferrer"
        >
          Defensa del Consumidor
        </a>
        . Para datos personales, la autoridad de aplicación es la{' '}
        <a href={LEGAL_LINKS.aaip} target="_blank" rel="noopener noreferrer">
          AAIP
        </a>
        .
      </p>

      <p className="legal-note">
        Versión 1.0 publicada el 23 de noviembre de 2026. La versión publicable se revisa con
        asesoría legal antes del go-live; las páginas y la aceptación versionada ya están
        implementadas.
      </p>
    </article>
  );
}
