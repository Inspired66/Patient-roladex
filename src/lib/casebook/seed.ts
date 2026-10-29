import { addDaysISO, todayISO } from "./format.ts";
import type { Contact, Patient } from "./types.ts";

export const SAMPLE_GENDERS: Record<string, string> = {
  "p-alvarez": "Female",
  "p-brooks": "Female",
  "p-chen": "Female",
  "p-hale": "Male",
  "p-moretti": "Male",
  "p-nguyen": "Male",
  "p-okonkwo": "Male",
  "p-patel": "Male",
  "p-rahman": "Female",
};

/** If a sample procedure is still on its original date, move it onto the live list. */
export const LEGACY_PROCEDURE_DATES: Record<string, { was: string; daysAhead: number }> = {
  "s-alvarez-1": { was: "2026-02-20", daysAhead: 2 },
  "s-moretti-1": { was: "2026-03-01", daysAhead: 5 },
  "s-okonkwo-1": { was: "2026-01-15", daysAhead: 16 },
  "s-nguyen-1": { was: "2025-06-11", daysAhead: 1 },
};

const AHEAD: Record<string, number> = {
  "s-alvarez-1": 2,
  "s-moretti-1": 5,
  "s-okonkwo-1": 16,
  "s-nguyen-1": 1,
};

function ahead(id: string, fallback: string) {
  const days = AHEAD[id];
  return days == null ? fallback : addDaysISO(todayISO(), days);
}

export function seedPatients(): Patient[] {
  const samples = [
    {
      id: "p-alvarez",
      sample: true,
      name: "Sofia Alvarez",
      dob: "1985-09-07",
      gender: "Female",
      phone: "0400 772 315",
      email: "sofia.alvarez@example.com",
      surgeries: [
        {
          id: "s-alvarez-1",
          date: ahead("s-alvarez-1", "2026-02-20"),
          surgeon: "Amir Shah",
          type: "ACL reconstruction",
          hospital: "St Vincent's",
          notes:
            "ASA 1. Fit. Airway grade 1. Spinal plus sedation discussed; proceeded with general anaesthetic and a laryngeal mask. Tourniquet time 68 min. Uneventful emergence.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-brooks",
      sample: true,
      name: "Eleanor Brooks",
      dob: "1955-12-01",
      gender: "Female",
      phone: "02 9382 1104",
      email: "e.brooks@example.com",
      surgeries: [
        {
          id: "s-brooks-1",
          date: "2023-10-09",
          surgeon: "Tom Ellis",
          type: "Lumbar laminectomy",
          hospital: "Prince of Wales",
          notes:
            "ASA 3. Hypertension, type 2 diabetes on metformin. Stopped SGLT2 two days prior. Prone, eyes checked, pressure points padded. Arterial line. Blood loss 180 mL. Extubated awake.",
          attachments: [],
        },
        {
          id: "s-brooks-2",
          date: "2018-04-14",
          surgeon: "Helen Ward",
          type: "Abdominal hysterectomy",
          hospital: "Royal Hospital for Women",
          notes:
            "Previous difficult IV access. 20g right forearm. Combined spinal-epidural. Block to T6. Phenylephrine infusion. Comfortable in recovery.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-chen",
      sample: true,
      name: "Margaret Chen",
      dob: "1961-04-03",
      gender: "Female",
      phone: "0412 880 214",
      email: "margaret.chen@example.com",
      surgeries: [
        {
          id: "s-chen-1",
          date: "2025-08-12",
          surgeon: "Helen Ward",
          type: "Laparoscopic cholecystectomy",
          hospital: "Royal Melbourne Hospital",
          notes:
            "ASA 2. BMI 31. Mallampati 2. Reflux on pantoprazole. Rapid sequence with video laryngoscope, grade 1 view. Ports insufflated without issue. Ondansetron and dexamethasone given. Day-case, escort confirmed.",
          attachments: [],
        },
        {
          id: "s-chen-2",
          date: "2019-02-02",
          surgeon: "Helen Ward",
          type: "Umbilical hernia repair",
          hospital: "Royal Melbourne Hospital",
          notes:
            "ASA 2. Straightforward general anaesthetic. Local infiltration by surgeon. Home the same evening.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-hale",
      sample: true,
      name: "Robert Hale",
      dob: "1948-01-12",
      gender: "Male",
      phone: "03 9812 4400",
      email: "robert.hale@example.com",
      surgeries: [
        {
          id: "s-hale-1",
          date: "2024-09-30",
          surgeon: "Helen Ward",
          type: "Right hemicolectomy",
          hospital: "Austin Hospital",
          notes:
            "ASA 3. Drug-eluting stent 2022, aspirin continued, other antiplatelet ceased five days prior after cardiology. Epidural T9 plus general anaesthetic. Arterial line and large-bore IV. Noradrenaline low dose. Extubated in theatre. HDU booked.",
          attachments: [],
        },
        {
          id: "s-hale-2",
          date: "2022-05-18",
          surgeon: "Tom Ellis",
          type: "Left cataract extraction",
          hospital: "Royal Victorian Eye and Ear",
          notes:
            "Topical plus intracameral. Light sedation with midazolam 0.5 mg. Calm. Oxygen nasal prongs.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-moretti",
      sample: true,
      name: "Luca Moretti",
      dob: "2001-08-16",
      gender: "Male",
      phone: "0455 018 773",
      email: "luca.moretti@example.com",
      surgeries: [
        {
          id: "s-moretti-1",
          date: ahead("s-moretti-1", "2026-03-01"),
          surgeon: "Amir Shah",
          type: "ORIF ankle",
          hospital: "Royal Melbourne Hospital",
          notes:
            "ASA 1E. Last ate 22:40. Spinal at L3/4, bupivacaine heavy 2.8 mL. Block dense. Sedation with propofol TCI. No tourniquet issues. Plan: elevate overnight.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-nguyen",
      sample: true,
      name: "David Nguyen",
      dob: "1972-03-22",
      gender: "Male",
      phone: "0433 901 662",
      email: "d.nguyen@example.com",
      surgeries: [
        {
          id: "s-nguyen-1",
          date: ahead("s-nguyen-1", "2025-06-11"),
          surgeon: "Priya Nair",
          type: "Thyroidectomy",
          hospital: "The Alfred",
          notes:
            "ASA 2. Goitre, no stridor. Awake fibreoptic not required; video laryngoscope grade 2a. NIM tube. Head-up. Dexamethasone. Smooth extubation. Calcium check ordered.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-okonkwo",
      sample: true,
      name: "James Okonkwo",
      dob: "1978-11-19",
      gender: "Male",
      phone: "0423 110 908",
      email: "j.okonkwo@example.com",
      surgeries: [
        {
          id: "s-okonkwo-1",
          date: ahead("s-okonkwo-1", "2026-01-15"),
          surgeon: "Amir Shah",
          type: "Total knee replacement",
          hospital: "Epworth Richmond",
          notes:
            "ASA 2. OSA on CPAP, bring machine. Spinal plus adductor canal catheter. Sedation. Tranexamic acid 1 g. Spinal wore off in recovery. CPAP overnight on the ward.",
          attachments: [],
        },
      ],
    },
    {
      id: "p-patel",
      sample: true,
      name: "Noah Patel",
      dob: "1994-07-30",
      gender: "Male",
      phone: "0488 220 019",
      email: "noah.patel@example.com",
      surgeries: [],
    },
    {
      id: "p-rahman",
      sample: true,
      name: "Aisha Rahman",
      dob: "1990-06-28",
      gender: "Female",
      phone: "0491 220 441",
      email: "aisha.rahman@example.com",
      surgeries: [
        {
          id: "s-rahman-1",
          date: "2025-11-03",
          surgeon: "Priya Nair",
          type: "Caesarean section",
          hospital: "Royal Women's Hospital",
          notes:
            "ASA 2. Category 3. Epidural topped up with 2% lignocaine plus adrenaline and fentanyl, block to T4. Phenylephrine infusion. Oxytocin 5 units slow. Baby cried at delivery. Partner present.",
          attachments: [],
        },
      ],
    },
  ];
  return samples.map((patient) => ({
    ...patient,
    notes:
      patient.id === "p-patel"
        ? "Rooms review. No regular medicines. Anxious about fasting. No procedures booked yet."
        : "",
    consults:
      patient.id === "p-patel"
        ? [
            {
              id: "c-patel-1",
              date: "2025-09-02",
              doctor: "Amir Shah",
              medicalCentre: "St Vincent's",
              notes:
                "Preoperative consult. Fit for day surgery when a date is booked. Airway looks easy.",
              attachments: [],
            },
          ]
        : [],
  }));
}

export function seedContacts(): Contact[] {
  return [
    {
      id: "c-shah",
      kind: "surgeon",
      sample: true,
      name: "Shah, Amir",
      phone: "0412 880 214",
      email: "amir.shah@example.com",
      specialty: "Orthopaedics",
      notes: "Rooms on Thursday. Prefers a call the evening before a list.",
    },
    {
      id: "c-ellis",
      kind: "surgeon",
      sample: true,
      name: "Ellis, Tom",
      phone: "0408 221 904",
      email: "tom.ellis@example.com",
      specialty: "Spine",
      notes: "Secretary holds the diary.",
    },
    {
      id: "c-ward",
      kind: "surgeon",
      sample: true,
      name: "Ward, Helen",
      phone: "0433 190 552",
      email: "helen.ward@example.com",
      specialty: "General surgery",
      notes: "Day cases at The Alfred on Mondays.",
    },
    {
      id: "c-nair",
      kind: "surgeon",
      sample: true,
      name: "Nair, Priya",
      phone: "0421 774 018",
      email: "priya.nair@example.com",
      specialty: "Obstetrics",
      notes: "After-hours contact is the birth suite, not these rooms.",
    },
    {
      id: "c-stv",
      kind: "hospital",
      sample: true,
      name: "St Vincent's",
      phone: "03 9231 2211",
      email: "theatre@example.com",
      specialty: "",
      notes: "Main theatre reception. Anaesthetic department on level 3.",
    },
    {
      id: "c-pow",
      kind: "hospital",
      sample: true,
      name: "Prince of Wales",
      phone: "02 9382 2222",
      email: "pow.theatre@example.com",
      specialty: "",
      notes: "Ask for the holding bay if a patient is already checked in.",
    },
    {
      id: "c-rhw",
      kind: "hospital",
      sample: true,
      name: "Royal Hospital for Women",
      phone: "02 9382 6111",
      email: "rhw.theatre@example.com",
      specialty: "",
      notes: "Birth suite and theatres share the same switchboard.",
    },
    {
      id: "c-rmh",
      kind: "hospital",
      sample: true,
      name: "Royal Melbourne Hospital",
      phone: "03 9342 7000",
      email: "rmh.theatre@example.com",
      specialty: "",
      notes: "City campus. Emergency theatre desk is separate from the elective list.",
    },
    {
      id: "c-austin",
      kind: "hospital",
      sample: true,
      name: "Austin Hospital",
      phone: "03 9496 5000",
      email: "austin.theatre@example.com",
      specialty: "",
      notes: "Heidelberg. Day-of-surgery admission is at the front desk.",
    },
    {
      id: "c-eye",
      kind: "hospital",
      sample: true,
      name: "Royal Victorian Eye and Ear",
      phone: "03 9929 8666",
      email: "eyeear.theatre@example.com",
      specialty: "",
      notes: "Short stay. Most lists finish by early afternoon.",
    },
    {
      id: "c-alfred",
      kind: "hospital",
      sample: true,
      name: "The Alfred",
      phone: "03 9076 2000",
      email: "alfred.theatre@example.com",
      specialty: "",
      notes: "Main theatres. Trauma lists can move during the day.",
    },
    {
      id: "c-epworth",
      kind: "hospital",
      sample: true,
      name: "Epworth Richmond",
      phone: "03 9426 6666",
      email: "epworth.theatre@example.com",
      specialty: "",
      notes: "Private. Confirm the bed the afternoon before.",
    },
    {
      id: "c-womens",
      kind: "hospital",
      sample: true,
      name: "Royal Women's Hospital",
      phone: "03 8345 2000",
      email: "rwh.theatre@example.com",
      specialty: "",
      notes: "Parkville. Caesarean lists run from birth suite theatres.",
    },
  ];
}
