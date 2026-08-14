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
      title: "Tres modalidades. Un solo flujo.",
      description:
        "Imagen, video y audio comparten los mismos trabajos, la misma biblioteca y los mismos créditos. Nada de esto es un segundo producto puesto al lado del primero.",
    },
    features: {
      eyebrow: "Por qué Atheos",
      title: "Pensado para lo que de verdad estorba",
      description:
        "No una lista de características más larga, sino más corta y dirigida a la fricción concreta de trabajar con varios proveedores de IA a la vez.",
    },
    howItWorks: {
      eyebrow: "Cómo funciona",
      title: "Cuatro pasos, sin vueltas",
      description:
        "De una idea a algo guardado en su biblioteca, con las partes que suelen salir mal ya resueltas.",
    },
    templates: {
      eyebrow: "Plantillas",
      title: "Empiece desde algo que ya funciona",
      description:
        "Estructuras de prompt con los parámetros listos para lograr un look. Edite lo que quiera: son puntos de partida, no rieles.",
    },
    gallery: {
      eyebrow: "Galería",
      title: "Un vistazo a la superficie",
      description:
        "El lenguaje visual de Atheos: color sobre negro y la luz tratada como algo que se emite, no que se pinta.",
      note: "Todas las imágenes de esta página las generó Atheos, con los mismos modelos que usted recibe. Pase el cursor sobre una para leer el prompt que la produjo.",
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
    { href: "#showcase", label: "Producto" },
    { href: "#features", label: "Características" },
    { href: "#how-it-works", label: "Cómo funciona" },
    { href: "#pricing", label: "Precios" },
    { href: "#faq", label: "Preguntas" },
  ],

  auth: {
    signIn: "Iniciar sesión",
    signUp: "Comenzar",
    dashboard: "Panel",
  },

  hero: {
    announcement: "En beta privada",
    headline: ["Todos los modelos de IA.", "Una sola interfaz."],
    subheadline:
      "Deje de manejar seis suscripciones y seis formas distintas de trabajar. Atheos reúne la generación de imagen, video y audio en un solo espacio: una biblioteca, un saldo de créditos y un solo lugar que aprender.",
    primaryCta: { label: "Solicitar acceso anticipado", href: "#pricing" },
    secondaryCta: { label: "Ver cómo funciona", href: "#how-it-works" },
    stats: [
      { value: "3", label: "Modalidades" },
      { value: "1", label: "Saldo de créditos" },
      { value: "0", label: "Dependencia de un proveedor" },
    ],
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
    {
      label: "Audio",
      headline: "Voz, música y diseño sonoro",
      body: "El mismo flujo, la misma biblioteca, los mismos créditos. El audio no es un segundo producto pegado encima con reglas propias.",
      bullets: [
        "Síntesis de voz y generación de música",
        "Una sola biblioteca para las tres modalidades",
        "Precio por modalidad, un solo saldo",
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
      title: "Sin dependencia de un proveedor",
      body: "Los proveedores viven detrás de una sola interfaz. Cuando sale un modelo mejor, aparece como una opción más, no como un proyecto de migración.",
    },
    {
      title: "Pensado para comparar",
      body: "El mismo prompt en varios modelos, uno al lado del otro. La única forma confiable de elegir un modelo es verlos discrepar.",
    },
    {
      title: "Sus archivos, en nuestro almacenamiento",
      body: "El material generado se copia a nuestro almacenamiento de inmediato. Los enlaces de los proveedores caducan, y una biblioteca llena de enlaces muertos una semana después no es una biblioteca.",
    },
    {
      title: "Diseñado para pasar horas dentro",
      body: "Oscuro por defecto, cómodo con el teclado y rápido. Es una herramienta para sesiones largas, no una demo que se ve bien en una captura.",
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
      title: "Déjelo correr",
      body: "Los trabajos corren en segundo plano. Cierre la pestaña si quiere. Los créditos se descuentan al terminar bien y se devuelven automáticamente cuando el fallo es del proveedor.",
    },
    {
      title: "Quédese con lo que funciona",
      body: "Los resultados llegan a su biblioteca con el prompt, la semilla y los parámetros adjuntos, para que una buena generación se pueda repetir y no solo admirar.",
    },
  ],

  templates: [
    {
      title: "Producto en set",
      category: "Comercial",
      body: "Luz de estudio, fondo continuo, reflejos controlados.",
    },
    {
      title: "Fotograma cinematográfico",
      category: "Cine",
      body: "Encuadre anamórfico, luz práctica, poca profundidad de campo.",
    },
    {
      title: "Retrato editorial",
      category: "Fotografía",
      body: "Luz principal suave, separación de contorno, color neutro.",
    },
    {
      title: "Escena isométrica",
      category: "Ilustración",
      body: "Geometría limpia, paleta plana, ángulo de luz constante.",
    },
    {
      title: "Bucle en movimiento",
      category: "Video",
      body: "Ciclo continuo de cuatro segundos para fondos y cabeceras.",
    },
    {
      title: "Locución en off",
      category: "Audio",
      body: "Tono calmado, registro medio, sin prisa, para narración explicativa.",
    },
  ],

  gallery: [
    "Luz volumétrica entre la niebla, anamórfico",
    "Cromo líquido, reflejo de estudio",
    "Aurora sobre agua negra, larga exposición",
    "Lluvia de neón, poca profundidad de campo",
    "Ciudad isométrica, paleta de atardecer",
    "Llamarada solar, detalle macro",
    "Nebulosa del espacio profundo, negros puros",
    "Bioluminiscencia, bajo el agua",
  ],

  pricing: {
    eyebrow: "Precios",
    title: "Pague por generaciones, no por usuarios",
    description:
      "Un solo saldo para todos los modelos y modalidades. Sin suscripciones por proveedor que cuadrar a fin de mes.",
    monthly: "Mensual",
    yearly: "Anual",
    yearlySave: "−20 %",
    mostPopular: "El más elegido",
    perMonth: "/ mes",
    forever: "para siempre",
    billedYearly: "al año",
    save: "ahorra",
    creditsMonthly: (credits) => `${credits} créditos al mes`,
    ctaFree: "Empezar gratis",
    ctaChoose: (plan) => `Elegir ${plan}`,
    note: "Los créditos se consumen por generación y su precio depende de la modalidad: el video cuesta más que una imagen porque a nosotros también nos cuesta más. Los créditos no usados se acumulan durante un mes. Cancele cuando quiera.",
  },

  plans: {
    STARTER: {
      name: "Gratis",
      description: "Un video y unas cuantas imágenes, para ver si le sirve.",
      features: [
        "1 video o 25 imágenes",
        "Video en 720p, modelo rápido",
        "Escalado de imagen a 4K",
        "Biblioteca completa y proyectos",
        "Derechos comerciales sobre todo lo que cree",
      ],
    },
    BASIC: {
      name: "Starter",
      description: "Para proyectos ocasionales, sin compromiso mensual.",
      features: [
        "3 videos u 87 imágenes al mes",
        "Video en 720p, modelo rápido",
        "Eliminación de fondo y escalado a 4K",
        "Biblioteca completa y proyectos",
        "Reembolso automático si falla el proveedor",
        "Derechos comerciales sobre todo lo que cree",
      ],
    },
    STUDIO: {
      name: "Creator",
      description: "Para una persona que publica con regularidad.",
      features: [
        "11 videos o 250 imágenes al mes",
        "Video en 1080p de hasta 12 segundos",
        "Todas las proporciones: 16:9, 9:16, 1:1, 21:9",
        "Los dos modelos de video, incluido Motion Pro",
        "Imagen a video e imágenes de referencia",
        "Eliminación de fondo y escalado a 4K",
        "Reembolso automático si falla el proveedor",
      ],
    },
    SCALE: {
      name: "Studio",
      description: "Para canales que publican a diario y equipos pequeños.",
      features: [
        "33 videos o 750 imágenes al mes",
        "Todo lo de Creator",
        "Generación y exportación por lotes",
        "Desglose de uso y costos",
        "Publicación en la galería de la comunidad",
        "Soporte por correo",
      ],
    },
    AGENCY: {
      name: "Agency",
      description: "Para estudios y agencias que producen en volumen.",
      features: [
        "222 videos o 5000 imágenes al mes",
        "Todo lo de Studio",
        "Los créditos no usados se acumulan durante un mes",
        "Generación y exportación por lotes",
        "Desglose completo de uso y costo por generación",
        "Soporte por correo",
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
      "Comparación de características entre los planes Gratis, Starter, Creator, Studio y Agency",
    free: "Gratis",
    perMonth: "/mes",
    included: "Incluido",
    notIncluded: "No incluido",
    values: { community: "Comunidad", email: "Correo", allSix: "Las seis" },
    rows: [
      { label: "Créditos mensuales" },
      {
        label: "Videos al mes",
        note: "A cinco segundos con el modelo estándar",
      },
      { label: "Imágenes al mes" },
      { label: "Generación de imagen" },
      { label: "Generación de video" },
      { label: "Resolución de video" },
      { label: "Duración máxima del clip" },
      {
        label: "Motion Pro, el modelo de mayor calidad",
        note: "Más lento de procesar, resultado claramente mejor",
      },
      { label: "Imagen a video" },
      { label: "Imágenes de referencia" },
      {
        label: "Proporciones de video",
        note: "Las otras cuatro llegan con Motion Pro",
      },
      { label: "Escalado a 4K" },
      { label: "Eliminación de fondo" },
      { label: "Proyectos y colecciones" },
      { label: "Paquetes de prompts del marketplace" },
      { label: "Publicar en la galería de la comunidad" },
      { label: "Generación y exportación por lotes" },
      { label: "Desglose de uso y costos" },
      {
        label: "Reembolso automático si falla el proveedor",
        note: "Los créditos vuelven en cuanto una generación falla",
      },
      { label: "Derechos comerciales" },
      { label: "Soporte" },
    ],
  },

  enterprise: {
    eyebrow: "Empresas y corporativo",
    title: "¿Necesita usuarios, SSO o factura?",
    body: [
      "Agency cubre el volumen: 20 000 créditos al mes, con tarjeta y sin necesidad de hablar con nadie. Lo que no cubre es la otra mitad de una compra corporativa: varias personas sobre un mismo saldo, inicio de sesión único, procesos de compras, o un modelo que todavía no ofrecemos.",
      "Eso está en construcción, y preferimos dimensionarlo contra una necesidad real antes que adivinar. Cuéntenos sus restricciones y le decimos cuánto cuesta y para cuándo, o le decimos con claridad si todavía no somos lo que busca.",
    ],
    cta: "Hablemos",
    needsTitle: "Vale la pena conversar si",
    needs: [
      "Necesita más de 20 000 créditos al mes",
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
        "Sí. El plan Gratis incluye 100 créditos al mes sin costo y sin tarjeta: un video o veinticinco imágenes. Alcanza para decidir si Atheos encaja con su forma de trabajar.",
    },
    {
      question: "¿Cuándo se lanza Atheos?",
      answer:
        "Atheos está en beta privada. Solicite acceso anticipado y nos comunicamos con usted a medida que se abre capacidad: preferimos incorporar despacio y que la generación siga siendo rápida, antes que abrir las puertas y dejar a todo el mundo en cola.",
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
          { label: "Galería", href: "#gallery" },
          { label: "Preguntas", href: "#faq" },
          { label: "Sistema de diseño", href: "/design-system" },
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
