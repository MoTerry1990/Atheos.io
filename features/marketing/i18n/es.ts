import type { MarketingCopy } from "@/features/marketing/i18n/copy";

/**
 * Latin American Spanish.
 *
 * ## Written, not translated
 *
 * The English copy is deliberately blunt — short sentences, no marketing
 * filler, claims that can be checked. A literal translation of that register
 * lands as brusque in Spanish, which prefers a slightly fuller sentence, so
 * some lines are rebuilt rather than converted. What must survive intact is
 * the *claim*: every number, guarantee and limitation says exactly what the
 * English says. Tone can move; facts cannot.
 *
 * ## Conventions
 *
 *  - **Usted**, not tú. Atheos sells to studios and businesses, and Latin
 *    American commercial writing defaults to usted; tuteo reads as consumer
 *    app, which is not what a $199 tier is.
 *  - **Latin American vocabulary**: *video* (no accent), *computadora*,
 *    *arriba* rather than peninsular alternatives. Never *vosotros*.
 *  - **Untranslated on purpose**: Atheos, Motion Pro, prompt, 4K, 1080p,
 *    720p, SSO. `prompt` in particular has no Spanish equivalent that anyone
 *    in this field actually uses — *indicación* would be clearer to a general
 *    reader and wrong to the buyer.
 *  - **Prices stay in dollars.** Atheos bills in USD through Stripe. Showing a
 *    sol or peso figure on the page and charging dollars at the card form is
 *    the single worst thing a localised pricing page can do.
 */
export const ES: MarketingCopy = {
  sections: {
    showcase: {
      eyebrow: "El producto",
      title: "Dos modalidades. Un solo flujo.",
      description:
        "Imagen y video comparten los mismos trabajos, la misma biblioteca y los mismos créditos. La generación de audio no se ofrece mientras su licencia esté sin resolver.",
    },
    features: {
      eyebrow: "Por qué Atheos",
      title: "Pensado para lo que de verdad estorba",
      description:
        "No una lista de características más larga, sino más corta y dirigida a la fricción concreta de trabajar con varios proveedores de IA a la vez.",
    },
    howItWorks: {
      eyebrow: "Cómo funciona",
      title: "Tres pasos, sin vueltas",
      description:
        "De una idea a algo guardado en su biblioteca, con las partes que suelen salir mal ya resueltas.",
    },
    templates: {
      eyebrow: "Plantillas",
      title: "Empiece desde algo que ya funciona",
      description:
        "Estructuras de prompt con los parámetros listos para lograr un look. Edite lo que quiera: son puntos de partida, no rieles.",
    },
    faq: {
      eyebrow: "Preguntas",
      title: "Las preguntas que vale la pena responder",
      description:
        "Incluidas aquellas cuya respuesta preferiríamos no tener que dar todavía.",
    },
  },

  site: {
    tagline: "Una sola interfaz. Todos los modelos de IA.",
    description:
      "Genere imágenes, video, audio y material creativo con varios proveedores de IA desde un mismo espacio de trabajo, cuidado hasta el último detalle.",
  },

  nav: [
    { href: "/studio", label: "Crear" },
    { href: "/models", label: "Modelos" },
    { href: "/explore", label: "Explorar" },
    { href: "/pricing", label: "Precios" },
  ],

  auth: {
    signIn: "Iniciar sesión",
    signUp: "Empiece a crear",
    dashboard: "Panel",
  },

  hero: {
    announcement: "Cree sin límites",
    headline: ["Un estudio creativo.", "Todos los modelos de IA."],
    subheadline:
      "Genere imágenes, video y audio desde un espacio de trabajo simple y bien hecho.",
    primaryCta: {
      label: "Empiece a crear",
      href: "/sign-up?redirect_url=%2Fstudio",
    },
    secondaryCta: { label: "Ver creaciones", href: "#made" },
    stats: [
      { value: "3", label: "Modalidades" },
      { value: "1", label: "Saldo de créditos" },
      { value: "0", label: "Dependencia de un proveedor" },
    ],
  },

  composer: {
    placeholders: {
      image:
        "Una figura solitaria en una calle mojada, reflejos de neón, anamórfico",
      video:
        "Avance lento por un bosque con niebla al amanecer, haces de luz, bruma",
    },
    modalities: [
      { id: "image", label: "Imagen" },
      { id: "video", label: "Video" },
    ],
    cta: "Crear",
    promptLabel: "Prompt",
    note: "Gratis para empezar, sin tarjeta. Su prompt le acompaña.",
    noteEmpty: "Gratis para empezar, sin tarjeta.",
  },

  made: {
    eyebrow: "Hecho con Atheos",
    title: "Las ideas se vuelven imagen, movimiento y sonido.",
    description:
      "Creaciones reales de los modelos que ejecuta el producto: imágenes fijas y clips cortos, cada uno con el prompt que lo produjo. Lleve cualquiera a su propio espacio de trabajo.",
    tryThis: "Probar esto",
    play: "Reproducir vista previa",
    filters: {
      label: "Filtrar creaciones",
      all: "Todo",
      images: "Imágenes",
      videos: "Vídeos",
    },
    count: "{count} creaciones",
  },

  trustedBy: { label: "Construido sobre infraestructura que ya conoce" },

  showcase: [
    {
      label: "Imagen",
      headline: "Todos los modelos de imagen, lado a lado",
      body: "Ejecute el mismo prompt en varios proveedores y compare los resultados en una sola vista. Las diferencias entre modelos saltan a la vista cuando puede verlas juntas, y son invisibles cuando no.",
      bullets: [
        "Compare proveedores con prompts idénticos",
        "Generación imagen a imagen y a partir de referencias",
        "Semillas, proporciones y prompts negativos donde el modelo los admita",
      ],
    },
    {
      label: "Video",
      headline: "Video que sobrevive a la espera",
      body: "Generar video toma minutos, no segundos. Atheos lo trata como algo normal: los trabajos entran en cola, corren en segundo plano y le dicen con honestidad cuando no hay nada que informar.",
      bullets: [
        "Trabajos en segundo plano: puede cerrar la pestaña",
        "Progreso real, sin barras de porcentaje inventadas",
        "Resultados servidos desde nuestro almacenamiento, no desde un enlace que caduca",
      ],
    },
  ],

  features: [
    {
      title: "Una biblioteca para todo",
      body: "Imágenes, video y audio llegan al mismo lugar, con búsqueda y etiquetas, sin importar qué modelo los produjo. Su trabajo no queda repartido entre seis paneles de proveedores.",
    },
    {
      title: "Un solo saldo de créditos",
      body: "Sin suscripciones separadas que cuadrar. Gaste de un único saldo, vea exactamente cuánto costó cada generación y reciba el reembolso automático cuando un proveedor falla.",
    },
    {
      title: "Sus archivos, en nuestro almacenamiento",
      body: "El material generado se copia a nuestro almacenamiento de inmediato. Los enlaces de los proveedores caducan, y una biblioteca llena de enlaces muertos una semana después no es una biblioteca.",
    },
  ],

  steps: [
    {
      title: "Descríbalo",
      body: "Escriba un prompt. Agregue imágenes de referencia si el modelo las admite. Atheos muestra únicamente los controles que el modelo elegido entiende de verdad, así que nunca tiene que adivinar qué ajustes aplican.",
    },
    {
      title: "Elija sus modelos",
      body: "Elija uno o varios. Ejecutar el mismo prompt en varios proveedores cuesta más créditos y responde la pregunta que realmente tiene: ¿cuál de estos sirve para este trabajo?",
    },
    {
      title: "Quédese con lo que funciona",
      body: "Los resultados llegan a su biblioteca con el prompt, la semilla y los parámetros adjuntos, para que una buena generación se pueda repetir y no solo admirar.",
    },
  ],

  templates: [
    {
      title: "Retrato editorial",
      category: "Fotografía",
      body: "Luz principal suave, separación de contorno, color neutro.",
    },
    {
      title: "Bucle en movimiento",
      category: "Video",
      body: "Ciclo continuo de cuatro segundos para fondos y cabeceras.",
    },
  ],

  pricing: {
    eyebrow: "Precios",
    title: "Pague por generaciones, no por usuarios",
    description:
      "Un solo saldo para todos los modelos y modalidades. Sin suscripciones por proveedor que cuadrar a fin de mes.",

    mostPopular: "El más elegido",
    perMonth: "/ mes",
    forever: "para siempre",
    creditsMonthly: (credits) => `${credits} créditos al mes`,
    creditsOneTime: (credits) => `${credits} créditos, por única vez`,
    creditsPending: "Los créditos se confirman al lanzar",
    ctaFree: "Empezar gratis",
    ctaChoose: (plan) => `Elegir ${plan}`,
    ctaPending: "Muy pronto",
    note: "Los créditos se consumen por generación y su precio depende de la modalidad: el video cuesta más que una imagen porque a nosotros también nos cuesta más. El estudio le muestra el precio exacto antes de generar, nunca después.",
  },

  plans: {
    FREE: {
      name: "Gratis",
      description: "Unas cuantas imágenes, para ver si el resultado le sirve.",
      features: [
        "Créditos de bienvenida al registrarse, por única vez",
        "Biblioteca completa y proyectos",
        "Derechos comerciales sobre todo lo que cree",
      ],
    },
    CREATOR: {
      name: "Creator",
      description: "Para una persona que publica con frecuencia.",
      features: [
        "Generación de video con Motion 1",
        "Video en 720p de hasta 7,5 segundos, en 16:9 o 9:16",
        "Imágenes de referencia para generar imágenes",
        "Eliminación de fondo y escalado a 4K",
        "3 generaciones a la vez",
      ],
    },
    PRO: {
      name: "Pro",
      description: "Para canales que publican todos los días.",
      features: [
        "Todo lo de Creator",
        "5 generaciones a la vez",
        "Generación y exportación por lotes",
        "Detalle de uso y costos",
        "Publicar en la galería de la comunidad",
        "Soporte por correo",
      ],
    },
    STUDIO: {
      name: "Studio",
      description: "Para estudios que producen en volumen.",
      features: [
        "Todo lo de Pro",
        "8 generaciones a la vez",
        "Detalle completo de uso y costos por generación",
        "Soporte prioritario por correo",
      ],
    },
  },

  packs: {
    eyebrow: "Recargas",
    title: "O compre créditos cuando los necesite",
    description:
      "Paquetes de una sola vez, sin suscripción. No caducan y se suman a la cuota mensual de su plan.",
    pack: "Paquete",
    price: "Precio",
    videos: "Videos",
    images: "Imágenes",
    credits: (count) => `${count} créditos`,
    note: "El conteo de videos supone el modelo estándar a cinco segundos. Los clips más largos y el modelo de mayor calidad cuestan más: el estudio le muestra el precio exacto antes de generar, nunca después.",
  },

  comparison: {
    eyebrow: "Comparar",
    title: "Qué incluye cada plan",
    description: "Cada fila es algo que el producto ya hace hoy.",
    feature: "Característica",
    caption:
      "Comparación de características entre los planes Gratis, Creator, Pro y Studio",
    free: "Gratis",
    perMonth: "/mes",
    included: "Incluido",
    notIncluded: "No incluido",
    values: {
      community: "Comunidad",
      email: "Correo",
      allSix: "Las seis",
      twoRatios: "16:9 y 9:16",
      pending: "Se confirma al lanzar",
    },
    rows: [
      {
        label: "Créditos",
        note: "Los del plan Gratis son por única vez; los planes pagos se renuevan cada mes",
      },
      { label: "Generación de imágenes" },
      { label: "Generación de video" },
      { label: "Resolución de video" },
      { label: "Duración máxima del clip" },
      { label: "Imágenes de referencia" },
      { label: "Formatos de video" },
      { label: "Generaciones a la vez" },
      { label: "Escalado a 4K" },
      { label: "Quitar el fondo" },
      { label: "Proyectos y colecciones" },
      { label: "Packs de prompts del marketplace" },
      { label: "Publicar en la galería de la comunidad" },
      { label: "Generación y exportación por lotes" },
      { label: "Detalle de uso y costos" },
      {
        label: "Devolución de créditos si la generación nunca empieza",
        note: "Las fallas posteriores al inicio del proveedor se revisan una por una",
      },
      { label: "Derechos comerciales" },
      { label: "Soporte" },
    ],
  },

  enterprise: {
    eyebrow: "Empresas y corporativo",
    title: "¿Necesita usuarios, SSO o factura?",
    body: [
      "Studio cubre el volumen, con tarjeta y sin necesidad de hablar con nadie. Lo que no cubre es la otra mitad de una compra corporativa: varias personas sobre un mismo saldo, inicio de sesión único, procesos de compras, o un modelo que todavía no ofrecemos.",
      "Eso está en construcción, y preferimos dimensionarlo contra una necesidad real antes que adivinar. Cuéntenos sus restricciones y le decimos cuánto cuesta y para cuándo, o le decimos con claridad si todavía no somos lo que busca.",
    ],
    cta: "Hablemos",
    needsTitle: "Vale la pena conversar si",
    needs: [
      "Necesita más volumen del que cubre el plan Studio",
      "Varias personas trabajan sobre un mismo saldo",
      "Quiere inicio de sesión único para su equipo",
      "Prefiere factura en lugar de tarjeta registrada",
      "Requiere un acuerdo de tratamiento de datos",
      "Necesita un modelo específico o usar sus propias claves",
      "Quiere soporte con un tiempo de respuesta comprometido",
    ],
  },

  faq: [
    {
      question: "¿Qué proveedores de IA admite Atheos?",
      answer:
        "Atheos está construido sin atarse a un proveedor: cada modelo vive detrás de una misma interfaz interna, así que agregar uno nuevo es un cambio de configuración y no una reconstrucción. La lista concreta del lanzamiento se está cerrando durante la beta privada, y la vamos a publicar antes de la apertura general en lugar de prometerla ahora.",
    },
    {
      question: "¿Necesito mis propias claves de API?",
      answer:
        "No. Atheos se encarga del acceso a los proveedores y de pagarles. Usted gasta créditos de un solo saldo y nunca administra cuentas de terceros, límites de uso ni facturas separadas.",
    },
    {
      question: "¿Qué pasa con mis créditos si una generación falla?",
      answer:
        "Se devuelven automáticamente. Los créditos se registran en un libro contable que solo admite altas, así que cada cargo y cada reembolso es auditable: una generación que falla del lado del proveedor nunca se le cobra.",
    },
    {
      question: "¿De quién es el resultado?",
      answer:
        "Suyo, sujeto a los términos del proveedor del modelo que lo generó. Atheos no reclama derechos sobre nada de lo que usted cree, y no entrenamos modelos con sus prompts ni con sus archivos.",
    },
    {
      question: "¿Dónde se guardan mis archivos generados?",
      answer:
        "En nuestro propio almacenamiento, no en una URL temporal del proveedor. El material se copia apenas termina el trabajo, así que su biblioteca sigue funcionando meses después. Puede exportar o borrar lo que quiera cuando quiera.",
    },
    {
      question: "¿Puedo comparar modelos con el mismo prompt?",
      answer:
        "Sí, y es una de las razones por las que el producto existe. Ejecute un prompt en varios modelos y vea los resultados lado a lado. Cada ejecución consume créditos por modelo, porque cada una es una generación real.",
    },
    {
      question: "¿Hay un plan gratuito?",
      answer:
        "Sí. Al registrarse recibe créditos de bienvenida por única vez, sin costo y sin tarjeta: alcanzan para generar un lote de imágenes y decidir si Atheos encaja con su forma de trabajar. Es un regalo de bienvenida, no una cuota mensual.",
    },
    {
      question: "¿Puedo usar Atheos hoy?",
      answer:
        "Sí. El registro está abierto y puede generar de inmediato: sin lista de espera y sin tarjeta. Atheos sigue en beta, así que las funciones cambian y algunas están incompletas; lo que aparezca como próximamente todavía no existe, no es que esté por salir.",
    },
  ],

  footer: {
    groups: [
      {
        title: "Producto",
        links: [
          { label: "Características", href: "#features" },
          { label: "Cómo funciona", href: "#how-it-works" },
          { label: "Plantillas", href: "#templates" },
          { label: "Precios", href: "#pricing" },
        ],
      },
      {
        title: "Recursos",
        links: [
          { label: "Hecho con Atheos", href: "#made" },
          { label: "Preguntas", href: "#faq" },
        ],
      },
      {
        title: "Empresa",
        links: [
          { label: "Conecte sus herramientas", href: "/connect" },
          { label: "Contacto", href: "mailto:hello@atheos.io" },
        ],
      },
      {
        title: "Legal",
        links: [
          { label: "Privacidad", href: "/privacy" },
          { label: "Términos", href: "/terms" },
          { label: "Uso aceptable", href: "/acceptable-use" },
        ],
      },
    ],
    note: "Atheos está en beta privada. Los detalles del producto pueden cambiar antes de la apertura general.",
    rights: "Todos los derechos reservados.",
  },

  language: { label: "Idioma" },
};
