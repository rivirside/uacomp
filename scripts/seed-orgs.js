#!/usr/bin/env node
'use strict';

/**
 * Seed student interest group links from uacomps.org/orgs into the DB.
 *
 * Usage:
 *   GUILD_ID=<your-guild-id> node scripts/seed-orgs.js
 *
 * Inserts each org as a link (same as /link add) so they appear in
 * /link list and are indexed in ChromaDB for /ask queries.
 *
 * Safe to re-run — uses INSERT OR IGNORE to skip already-present URLs.
 */

const { getDb } = require('../db');

const GUILD_ID = process.env.GUILD_ID;
if (!GUILD_ID) {
  console.error('Error: set GUILD_ID environment variable before running.');
  console.error('  GUILD_ID=123456789 node scripts/seed-orgs.js');
  process.exit(1);
}

const BASE = 'https://www.uacomps.org/orgs';

const ORGS = [
  // ── Specialty Interest Groups ──────────────────────────────────────────────
  {
    name: 'Aerospace Medicine Interest Group',
    slug: 'aerospace-medicine-interest-group',
    desc: 'Dedicated to advancing knowledge in aerospace, hyperbaric, and dive medicine by exploring the unique physiological challenges of human health and performance in extreme environments. Prepares future physicians to innovate and improve safety in aviation, spaceflight, and underwater exploration.'
  },
  {
    name: 'American Medical Association (AMA)',
    slug: 'ama',
    desc: 'The AMA chapter focuses on advocacy, leadership, and education regarding health policy and physician activism while empowering students to shape medicine\'s future through informed engagement.'
  },
  {
    name: 'American Medical Women\'s Association (AMWA)',
    slug: 'amwa',
    desc: 'Mission is to advance women in medicine and improve women\'s health through leadership, advocacy, education, and mentoring. Aims to empower women in medicine for healthcare leadership roles while advocating for gender equity.'
  },
  {
    name: 'American Physician Scientists Association (APSA)',
    slug: 'psig',
    desc: 'Aims to expose medical students to various types of research in clinical practice and increase interest in incorporating research into future medical careers. Hosts speaker panels across research domains and facilitates a journal club for clinically relevant research.'
  },
  {
    name: 'Anesthesiology Interest Group',
    slug: 'anesthesiology',
    desc: 'Aims to explore the multifaceted world of anesthesia through education, hands-on learning, research, and advocacy. Provides simulation training, faculty mentorship, and connects students with research in anesthesiology and perioperative medicine.'
  },
  {
    name: 'Association of Women Surgeons (AWS)',
    slug: 'association-of-women-surgeons',
    desc: 'Mission is to empower women to pursue careers in surgical specialties by providing mentorship, shadowing opportunities, and presentations from female surgeons. Aims to increase female representation in surgery through connecting students with accomplished mentors.'
  },
  {
    name: 'Cardiovascular Interest Group (CVIG)',
    slug: 'cvig',
    desc: 'Aims to provide an inclusive, engaging environment for anyone interested in cardiology. Delivers meaningful insights into cardiovascular medicine through academic workshops and clinician speaker panels.'
  },
  {
    name: 'Critical Care Interest Group (CCIG)',
    slug: 'critical-care-interest-group-ccig',
    desc: 'Aims to introduce medical students to critical care medicine through hands-on training in skills like airway and cardiac arrhythmia management. Offers speaker sessions, demonstrations of critical care equipment, and mentoring.'
  },
  {
    name: 'Dermatology Interest Group (DIG)',
    slug: 'dig',
    desc: 'Aims to educate medical students about dermatology through information, resources, and experiences. Hosts presentations from local dermatologists, organizes shadowing, and conducts clinical skills sessions focused on dermatology procedures and advanced suturing.'
  },
  {
    name: 'Diagnostic Radiology Interest Group (DRIG)',
    slug: 'radiology',
    desc: 'Mission is to engage in the future of medicine by integrating patient care, innovation, and medical education through Diagnostic Radiology. Expands access to radiology education and fosters early exposure to image-guided procedures while promoting minimally invasive care.'
  },
  {
    name: 'Emergency Medicine Interest Group (EMIG)',
    slug: 'emig',
    desc: 'Dedicated to fostering understanding of emergency healthcare through hands-on skills events, unique education opportunities, and collaboration with active EM professionals. Showcases clinical skills, real-world scenarios, and mentorship programs for aspiring students.'
  },
  {
    name: 'Environmental/Occupational Medicine Interest Group (EOMIG)',
    slug: 'environmentaloccupational-medicine-interest-group-eomig',
    desc: 'Dedicated to exploring the unique environmental and occupational health challenges that affect communities in Arizona, including extreme heat, water quality issues, and regional industries. Encourages students to integrate environmental health into medical practice through mentorship and research.'
  },
  {
    name: 'Family Medicine Interest Group (FMIG)',
    slug: 'fmig',
    desc: 'Aims to serve the community, inspire students to pursue family medicine, and prepare leaders for the future of healthcare. Provides hands-on clinical training in procedural skills while fostering connections with practicing physicians and residency programs.'
  },
  {
    name: 'Gastroenterology & Hepatology Interest Group (GHIG)',
    slug: 'gastroenterology-hepatology-interest-group',
    desc: 'Mission is to foster a community dedicated to advancing knowledge in gastroenterology and hepatology. Provides educational opportunities through lunch talks, workshops, mentorship, and shadowing experiences in gastrointestinal and hepatic diseases.'
  },
  {
    name: 'Hematology-Oncology Interest Group (HOIG)',
    slug: 'hematology-oncology-interest-group',
    desc: 'Mission is to help medical students explore hematology and oncology through educational events, shadowing experiences, and research opportunities. Presents both clinical and research perspectives in these rapidly evolving medical fields.'
  },
  {
    name: 'Infectious Disease Interest Group (IDIG)',
    slug: 'infectious-disease-ig',
    desc: 'Aims to promote infectious disease as an exciting medical career choice while demonstrating how ID impacts all aspects of medicine, antimicrobial stewardship, public health, and global health. Offers guest speakers, panels, and shadowing experiences to inspire students.'
  },
  {
    name: 'Integrative and Preventive Medicine IG (IPMIG)',
    slug: 'imis',
    desc: 'Aims to enhance and expand medical students\' understanding of evidence-based complementary and alternative medicine. Provides educational opportunities in integrative, preventive, and lifestyle medicine while emphasizing physician wellness and community health.'
  },
  {
    name: 'Internal Medicine Interest Group (IMIG)',
    slug: 'imig',
    desc: 'Aims to support COM-P medical students exploring internal medicine and its subspecialties while engaging local physicians. Hosts educational events and facilitates volunteer, shadowing, and research opportunities within the field.'
  },
  {
    name: 'Interventional Radiology Interest Group (IRIG)',
    slug: 'interventional-radiology-interest-group-irig',
    desc: 'Aims to engage in the future of medicine by integrating patient care, innovation, and medical education through Interventional Radiology. Provides hands-on procedural training and promotes minimally invasive, patient-centered care.'
  },
  {
    name: 'Med-Peds Interest Group',
    slug: 'med-peds-ig',
    desc: 'Aims to introduce medical students to the combined residency training program in Internal Medicine and Pediatrics. Increases awareness through speaker events, mentorship, and conference attendance, supporting students interested in caring for patients across all ages.'
  },
  {
    name: 'Neurosurgery Interest Group (NSurg)',
    slug: 'neurosurgery-interest-group-nsurg',
    desc: 'Mission is to foster a culture of collaboration, inclusivity, and productivity among learners and mentors engaging in neurosurgical research. Provides translational research opportunities by connecting learners with mentors at different training levels.'
  },
  {
    name: 'Obstetrics & Gynecology IG (OB/GYN IG)',
    slug: 'obgyn',
    desc: 'Seeks to expose students to obstetrics and gynecology while showcasing diverse career paths. Provides practical learning opportunities and mentorship connections with physicians, emphasizing patient perspectives and women\'s health education.'
  },
  {
    name: 'Ophthalmology Interest Group (SIGO)',
    slug: 'sigo',
    desc: 'Aims to provide all students interested in ophthalmology with the resources and information needed to succeed in residency matching. Creates opportunities for clinical exposure, community outreach, and educational events focused on eye health.'
  },
  {
    name: 'Orthopaedic Surgery Interest Group (OSIG)',
    slug: 'osig',
    desc: 'Empowers medical students to explore orthopedic surgery careers through education, hands-on experiences, and mentorship. Provides seminars, shadowing, casting clinics, suture training, and research opportunities.'
  },
  {
    name: 'Otolaryngology Interest Group (ENT IG)',
    slug: 'otolaryngology-interest-group',
    desc: 'Aims to provide the UACOM-P community with a look inside the diverse and innovative field of otolaryngology through interactive and educational events. Fills a gap in standard curricula with simulation events and seminars from visiting specialists.'
  },
  {
    name: 'Pathology Interest Group',
    slug: 'pathology-interest-group',
    desc: 'Aims to educate interested medical students about the scope and practice of pathology while fostering connections with local pathologists. Helps members explore the specialty and prepare for competitive pathology residency applications.'
  },
  {
    name: 'Pediatrics Interest Group (PIG)',
    slug: 'pig-1',
    desc: 'Aims to broaden student exposure to pediatric medicine while supporting exploration of pediatric subspecialties and connecting students with medical professionals. Organizes hands-on events and fosters networking opportunities with healthcare professionals.'
  },
  {
    name: 'Perioperative and Pain Medicine IG',
    slug: 'perioperative-and-pain-medicine-ig',
    desc: 'Mission is to foster interest in pain medicine by providing education, mentorship, and clinical exposure while promoting evidence-based, multidisciplinary approaches to pain management. Supports students pursuing procedural medicine, research, and advocacy in pain management.'
  },
  {
    name: 'Physical Medicine & Rehabilitation Interest Group (PM&R IG)',
    slug: 'physical-medicine-rehabilitation-interest-group',
    desc: 'Dedicated to providing education and exposure regarding Physical Medicine & Rehabilitation. Facilitates seminars, workshops, and clinical experiences to help students explore how physiatrists treat conditions affecting the nervous and musculoskeletal systems.'
  },
  {
    name: 'Plastic Surgery Interest Group',
    slug: 'plastic-surgery-interest-group',
    desc: 'Aims to provide students with opportunities to explore the clinical, research, and procedural aspects of plastic surgery. Hosts graft demonstrations, suture clinics, and guest speaker sessions in an inclusive community.'
  },
  {
    name: 'Psychiatry Interest Group (Psych IG)',
    slug: 'pig',
    desc: 'Aims to bridge the gap between medical education and psychiatric practice while cultivating a community committed to mental health mastery. Prioritizes clinical exposure, research, and mentorship to reduce stigma surrounding psychiatric conditions, emphasizing physician wellness and health equity.'
  },
  {
    name: 'Rural Medicine Interest Group (RMIG)',
    slug: 'rural-medicine-interest-group-rmig',
    desc: 'Aims to address the physician shortage in rural America, where ~20% of the population resides but only 11% of physicians practice. Provides opportunities to explore rural healthcare disparities and consider rural rotations or careers.'
  },
  {
    name: 'Ruth Jackson Orthopedic Society / Women in Orthopedics (RJOS)',
    slug: 'ruth-jackson-orthopedic-society-rjoswomen-in-orthopedics',
    desc: 'Aims to promote gender diversity within orthopedic surgery while supporting women\'s professional growth. Facilitates mentorship, exposure to orthopedic careers, and networking through events like lunch talks with female surgeons and hands-on workshops.'
  },
  {
    name: 'Sports Medicine Interest Group (SMIG)',
    slug: 'sportsmed',
    desc: 'Educates medical students about sports medicine in primary care and orthopedic settings. Provides hands-on experience through free sports physicals for youth athletes, shadowing physicians at high school football games, and assisting with local race and triathlon coverage.'
  },
  {
    name: 'Student Interest Group in Neurology (SIGN)',
    slug: 'sign',
    desc: 'Aims to inspire medical students about neurology by showcasing amazing opportunities in the field and connecting students with networking, research, and educational resources. Highlights how neurology offers both acute hospital care and long-term chronic disease management.'
  },
  {
    name: 'Surgery Interest Group (SIG)',
    slug: 'surg',
    desc: 'Aims to promote student exposure to general surgery and surgical subspecialties through educational events and networking. Organizes journal clubs, mentorship sessions, and talks featuring surgical professionals to help students explore various surgical career pathways.'
  },
  {
    name: 'Urology Interest Group',
    slug: 'urology-interest-group',
    desc: 'Aims to foster a dynamic and inclusive community dedicated to advancing knowledge and interest in urology. Helps students explore urology as a specialty and build connections with practicing urologists through educational events and networking.'
  },
  {
    name: 'Wilderness Medicine Interest Group (WMIG)',
    slug: 'wilderness-medicine-interest-group-wmig',
    desc: 'Seeks to prepare students for recognizing and managing injuries in outdoor settings while building competence in remote environments. Focuses on critical thinking, ingenuity, and adaptability through workshops, outdoor excursions, and skill-building.'
  },

  // ── Non-Specialty Interest Groups ─────────────────────────────────────────
  {
    name: 'Adverse Childhood Experiences / Trauma-Informed Care IG',
    slug: 'adverse-childhood-experiencestrauma-informed-care-ig',
    desc: 'Mission is to build an understanding of developmental trauma, ACEs, and Trauma-Informed Care among students, faculty, and staff at UA COM-P. Helps healthcare providers recognize how developmental trauma impacts patients and implement trauma-informed approaches.'
  },
  {
    name: 'Artificial Intelligence Interest Group (AI IG)',
    slug: 'artificial-intelligence-ai-interest-group',
    desc: 'Aims to explore how artificial intelligence may become integrated into healthcare as well as the ethics and legal challenges surrounding this area. Hosts educational talks with AI researchers and physicians along with workshops on AI\'s real-world applications in medicine.'
  },
  {
    name: 'Asian Pacific American Medical Student Association (APAMSA)',
    slug: 'asian-pacific-american-medical-student-association-apamsa',
    desc: 'Dedicated to addressing the unique health challenges of Asian American, Native Hawaiian, and Pacific Islander (AANHPI) communities. Focuses on health disparities awareness through advocacy and outreach while fostering professional networking with community partners.'
  },
  {
    name: 'Building the Next Generation of Academic Physicians',
    slug: 'building-the-next-generation-of-academic-physicians',
    desc: 'Helps diverse medical students and residents discover academic medicine as a career path by providing resources to explore and embark on an academic medicine career. Supports students combining clinical practice with research through workshops, mentorship, and skill-building.'
  },
  {
    name: 'Business in Medicine Interest Group',
    slug: 'business-in-medicine',
    desc: 'Mission is to increase understanding among future physicians of the intricacies and intersection of business, finance, and medicine. Empowers students to make informed decisions about finances, investments, and how economic forces shape healthcare delivery.'
  },
  {
    name: 'Catholic Medical Association (CMA)',
    slug: 'catholic-medical-association-cma-1',
    desc: 'Aims to form and support medical students in living and promoting Catholic Faith principles within medical science and practice. Provides fellowship through masses, meals, and talks from local Catholic physicians, welcoming all students interested in this community.'
  },
  {
    name: 'Chess Club',
    slug: 'chess-club',
    desc: 'A student-led organization providing a casual, welcoming environment where everyone of all experience levels can learn and enjoy chess. Combines intellectual development with social connection and camaraderie among medical students.'
  },
  {
    name: 'Christian Medical Society (CMS)',
    slug: 'cms',
    desc: 'Aims to create community for Christian healthcare students through interaction, encouragement, support, and service. Fosters personal, professional, and spiritual growth while connecting members with mentors and service opportunities.'
  },
  {
    name: 'Climbing Cats',
    slug: 'climbing-cats',
    desc: 'Dedicated to fostering the physical and mental well-being of students through engaging climbing events. Organizes regular climbing activities to provide medical students with stress relief and a healthy outlet while building community connections regardless of experience level.'
  },
  {
    name: 'Country Dance Cats',
    slug: 'country-dance-cats',
    desc: 'Aims to provide an opportunity for beginners and pros to experience Country dancing around the Phoenix area. Teaches foundational skills in Country Swing and Line dancing while organizing outings to local dance venues.'
  },
  {
    name: 'Culinary Medicine Interest Group',
    slug: 'culinary-medicine-interest-group',
    desc: 'Seeks to enhance understanding and practical use of healthy, nutritious foods among future medical professionals, patients, and community members. Helps future physicians understand food as a preventive health tool and guide patients toward healthier lifestyles.'
  },
  {
    name: 'Etymology Interest Group / Leech',
    slug: 'etymology-ig-leech',
    desc: 'Mission is to explore the linguistic roots and stories behind medical terminology, helping students remember concepts more easily. Functions as a journal club that identifies historical and etymologic connections in medical terms through monthly meetings.'
  },
  {
    name: 'Fitness Interest Group',
    slug: 'fitness-ig',
    desc: 'Mission is to support medical student well-being by encouraging regular physical activity, balanced fitness habits, and a culture of wellness throughout medical training. Promotes physical activity and overall wellness in an inclusive environment for students across all fitness levels.'
  },
  {
    name: 'Futbol Doctors',
    slug: 'futbol-doctors',
    desc: 'Dedicated to building community and balance among medical students through a shared love of soccer. Organizes World Cup watch parties, FIFA tournaments, and casual scrimmages, promoting well-being, friendship, and joy during medical training.'
  },
  {
    name: 'Harm Reduction & Addiction Medicine',
    slug: 'harm-reduction-addiction-medicine',
    desc: 'A dual CHIP program and Interest Group committed to improving medical student education in addiction medicine and supporting people who use drugs in the community. Focuses on reducing negative consequences of drug use while challenging stigma and advocating for patient-centered policies.'
  },
  {
    name: 'IGNITEMED',
    slug: 'ignitemed',
    desc: 'A program with interactive lectures, high-yield topic discussions, and group coaching from national experts on topics absent from standard medical education. Founded by women physicians specifically for female medical students to address the distinctive obstacles women face in medicine.'
  },
  {
    name: 'Jazz Interest Group',
    slug: 'jazz-interest-group',
    desc: 'Aims to bring medical students and jazz enthusiasts together to foster deeper appreciation of live jazz performances in the Phoenix area. Promotes jazz music\'s cultural significance and historical legacy through monthly performances and collaborative events.'
  },
  {
    name: 'Jewish Medical Student Association (JMSA)',
    slug: 'jmsa',
    desc: 'Aims to promote social, cultural, and educational opportunities relating to Judaism and the medical field. Creates a welcoming community for Jewish medical students to celebrate their heritage, engage with Jewish healthcare values, and participate in holiday celebrations and professional networking.'
  },
  {
    name: 'Latino Medical Student Association (LatinoMed / LMSA)',
    slug: 'latinomed',
    desc: 'Mission is to unite and empower current and future physicians through service, mentorship, and education to advocate for the improved health of the Hispanic and Latina/o/x community. Promotes recruitment and retention of Latino medical students and creates leadership opportunities.'
  },
  {
    name: 'Law and Medicine Interest Group',
    slug: 'law-and-medicine-interest-group',
    desc: 'Aims to educate students about the intricacies of medical practice and health law by hosting seminars and discussions with experts. Helps future physicians understand healthcare law complexities and explore career opportunities at the intersection of medicine and law.'
  },
  {
    name: 'LGBTQIA+ In Medicine',
    slug: 'lgbtq-in-medicine',
    desc: 'Mission is to foster an inclusive, supportive community for LGBTQ+ medical trainees and allies, promote health equity for LGBTQ+ patients, and advocate for improved understanding of queer health through education, mentorship, and service.'
  },
  {
    name: 'Medical Ethics Interest Group (MEIG)',
    slug: 'medical-ethics-interest-group',
    desc: 'Aims to inform and educate the UACOM-P community on prominent issues in medical ethics while equipping students to navigate ethical challenges in clinical practice. Facilitates learning through case discussions and expert talks, promoting advocacy for equitable healthcare.'
  },
  {
    name: 'Medical French Interest Group',
    slug: 'medical-french-interest-group',
    desc: 'Mission is to promote proficiency in medical French while fostering cultural competence, global health awareness, and service to French-speaking patient populations through education, collaboration, and community engagement.'
  },
  {
    name: 'Medical Students for Choice (MS4C)',
    slug: 'ms4c',
    desc: 'Dedicated to ensuring comprehensive reproductive healthcare access and training. Works to integrate abortion education and training into standard medical curricula while supporting student advocacy in reproductive health.'
  },
  {
    name: 'Meditation Interest Group',
    slug: 'meditation-interest-group',
    desc: 'A student-led group that promotes mental health and wellness through meditation and mindfulness practices. Welcomes participants of all experience levels and provides a supportive environment for students to develop contemplative skills during medical school.'
  },
  {
    name: 'Med Mentors',
    slug: 'med-mentors',
    desc: 'Aims to empower and guide pre-med students on their journey to medical school by providing mentorship, workshops, and resources. Focuses on supporting underrepresented and first-generation students through pipeline programs and longitudinal mentor-mentee relationships.'
  },
  {
    name: 'Middle East and North Africa Medical Student IG (MENA IG)',
    slug: 'middle-east-and-north-africa-mena-medical-student-interest-group',
    desc: 'Mission is to integrate the rich traditions of Middle Eastern and North African cultures into the medical field through cultural events, mentorship, and volunteer opportunities. Builds an inclusive community while promoting culturally competent healthcare practice.'
  },
  {
    name: 'Music in Medicine IG',
    slug: 'music-in-medicine-ig',
    desc: 'Enables students to pursue their musical interests while exploring healthcare applications through interactive workshops centered around music in healthcare settings. Volunteers with patients, particularly those with dementia at facilities like Hospice of the Valley.'
  },
  {
    name: 'Muslim Medical Students Association (MMSA)',
    slug: 'mmsa',
    desc: 'Mission is to empower Muslim medical students by offering opportunities for spiritual growth, professional development, and community building. Helps physicians understand the unique healthcare needs of Muslim patients while fostering culturally competent medical care.'
  },
  {
    name: 'Native American Service & Equity (NASE)',
    slug: 'native-american-service-and-equity-nase-ig',
    desc: 'Aims to educate medical students about and provide opportunities to serve Native American populations. Focuses on addressing health disparities, promoting community outreach, and amplifying Native voices to advance health equity initiatives.'
  },
  {
    name: 'Orthodox Christian Student Association',
    slug: 'orthodox-christian-association',
    desc: 'Aims to support Orthodox Christian students through worship, service, education, and fellowship. Creates space for spiritual growth and discussion while fostering respectful dialogue across different faith traditions within the medical school community.'
  },
  {
    name: 'Point of Care Ultrasound IG (POCUS IG)',
    slug: 'pocus-ig',
    desc: 'Aims to foster a dynamic community passionate about advancing point-of-care ultrasound. Provides interactive workshops and hands-on learning to equip medical students with clinical knowledge and practical ultrasound skills for clerkships and future careers.'
  },
  {
    name: 'RAD-AID',
    slug: 'rad-aid',
    desc: 'A student-run chapter dedicated to enhancing access to medical imaging in underserved regions globally. Connects members with physicians engaged in international radiology outreach and facilitates research opportunities and participation in the annual RAD-AID conference.'
  },
  {
    name: 'Recreational Sports Interest Group',
    slug: 'recreational-sports-interest-group',
    desc: 'Mission is to promote physical health, mental well-being, and community among medical students through inclusive, low-pressure recreational sports. Facilitates regular games in volleyball, soccer, and basketball, welcoming all skill levels while emphasizing teamwork and stress relief.'
  },
  {
    name: 'Ringside Med',
    slug: 'ringside-med',
    desc: 'Aims to provide relief for ringside physicians and help make combat sports safer by having medical students assist with MMA and boxing events in Arizona. Members help monitor fighter vitals and neurological status to identify potential traumatic brain injuries.'
  },
  {
    name: 'South Asian Medical Student Association (SAMSA)',
    slug: 'south-asian-medical-student-association',
    desc: 'Aims to unify South Asian medical students across the United States while raising awareness of healthcare issues affecting South Asian communities. Creates spaces for cultural celebration, professional networking, and educational discussions about health concerns relevant to this demographic.'
  },
  {
    name: 'Spoke Squad',
    slug: 'spoke-squad',
    desc: 'A cycling club focused on connecting med students who want to stay active and explore Arizona\'s beautiful trails. Emphasizes community bonding, outdoor recreation, and wellness breaks from academic demands.'
  },
  {
    name: 'Student National Medical Association (SNMA)',
    slug: 'student-national-medical-association-snma',
    desc: 'Dedicated to supporting and empowering underrepresented minority medical students while tackling healthcare disparities. Combines mentorship, community service, and professional development to build compassionate leaders who advance health equity in underserved communities.'
  },
  {
    name: 'Students for a National Health Program',
    slug: 'students-for-a-national-health-program',
    desc: 'A political advocacy group dedicated to advancing universal healthcare, believing that healthcare is a human right requiring quality, affordability, and accessibility. Engages with legislators, educates students about healthcare systems, and organizes campaigns to promote systemic change.'
  },
  {
    name: 'SYNAPSE',
    slug: 'synapse',
    desc: 'Creates an inclusive space for UA COM-P students to explore movement and express themselves through choreography, welcoming participants regardless of experience level. Emphasizes performance dance styles like street and contemporary, offering workshops and classes.'
  },
  {
    name: 'T1D Care Interest Group',
    slug: 't1d-care-interest-group',
    desc: 'Aims to educate medical students about type 1 diabetes (T1D) and how to best provide continuing care for patients with T1D, while providing outreach opportunities to support the Phoenix T1D community. Also creates campus community for medical students living with T1D.'
  },
];

async function main() {
  const db = getDb();

  // Ensure the guild row exists (links FK requires it)
  db.prepare('INSERT OR IGNORE INTO guilds (id, name) VALUES (?, ?)').run(GUILD_ID, 'seeded');

  const insert = db.prepare(`
    INSERT OR IGNORE INTO links (guild_id, url, title, description, added_by)
    VALUES (?, ?, ?, ?, 'seed-script')
  `);

  const run = db.transaction(() => {
    let inserted = 0;
    let skipped  = 0;
    for (const org of ORGS) {
      const url    = `${BASE}/${org.slug}`;
      const result = insert.run(GUILD_ID, url, org.name, org.desc);
      if (result.changes) inserted++;
      else skipped++;
    }
    return { inserted, skipped };
  });

  const { inserted, skipped } = run();
  console.log(`Done. Inserted ${inserted} orgs, skipped ${skipped} (already present).`);
  console.log('');
  console.log('Next: restart the bot (npm start) so the RAG indexer picks up the new links,');
  console.log('or run the bot and it will index them automatically on startup.');
}

main().catch((err) => { console.error(err); process.exit(1); });
