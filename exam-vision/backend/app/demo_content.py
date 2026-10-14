# backend/app/demo_content.py
"""Paper Correction demo (Holy Sai): two Grade 5 A tests, five students each.

SAMPLE DATA. The answers are what the rendered sheets in demo_sheets/ show; the marks and
explanations are what Claude suggested and what the teacher then decided. Students are the
seeded Holy Sai records, matched by admission number.

Answer tuple: (text, awards per criterion, AI notes) where notes may hold
  why    — explanation for criteria below full marks (one per criterion, or one for all)
  miss   — missing concepts, mis — misconceptions, good — strengths
  review — reason the AI asked for a teacher's review
  teacher — (new awards, reason): the teacher changed the AI's marks
"""

from __future__ import annotations

CLASS = "Grade 5 · GDV"
SECTION = "A"

SCIENCE = {
    "key": "science",
    "name": "Unit Test 2 — Science",
    "subject": "Science",
    "grade_level": "Cambridge Primary, Stage 5",
    "instructions": "Short answers. Do not deduct for spelling when the meaning is clear.",
    "teacher": "Ganesh Venkat",
    "results": "published",
    "questions": [
        {"number": "1", "text": "Name two things a plant needs to make its own food.", "max": 2,
         "criteria": [("C1", "Names one correct need (sunlight, water or carbon dioxide)", 1),
                      ("C2", "Names a second, different correct need", 1)],
         "ref": "Sunlight, water and carbon dioxide (air).", "concepts": ["sunlight", "water", "carbon dioxide"],
         "alt": ["light from the sun", "air"], "misc": ["Soil is food for the plant"]},
        {"number": "2", "text": "What is the process by which plants make food called? In which part of the plant does it mostly happen?", "max": 2,
         "criteria": [("C1", "Names photosynthesis", 1), ("C2", "Says it happens in the leaves", 1)],
         "ref": "Photosynthesis; mostly in the leaves.", "concepts": ["photosynthesis", "leaves"], "alt": ["leaf"],
         "misc": ["Photosynthesis happens in the roots"]},
        {"number": "3", "text": "Water turns into ice. Name this change and say whether it can be reversed.", "max": 2,
         "criteria": [("C1", "Names the change as freezing", 1), ("C2", "States that it is reversible", 1)],
         "ref": "Freezing. It is reversible — ice melts back into water.", "concepts": ["freezing", "reversible change"],
         "alt": ["solidifying"], "misc": ["Calling freezing 'melting'"]},
        {"number": "4", "text": "Name the three states of matter and give one example of each.", "max": 2,
         "criteria": [("C1", "Names solid, liquid and gas", 1), ("C2", "Gives a correct example for each of the three", 1)],
         "ref": "Solid (stone), liquid (water), gas (air).", "concepts": ["solid", "liquid", "gas"], "alt": [], "misc": []},
        {"number": "5", "text": "Why should we wash our hands before eating?", "max": 2,
         "criteria": [("C1", "Mentions germs / bacteria", 1), ("C2", "Explains that it prevents illness", 1)],
         "ref": "To remove germs so they do not enter our body and make us ill.", "concepts": ["germs", "preventing illness"],
         "alt": ["bacteria", "viruses"], "misc": []},
    ],
    "sheets": [
        {"no": "HS-2026-1041", "approved": True, "answers": {
            "1": ("Sunlight and water.", [1, 1], {"good": ["Names two correct needs"]}),
            "2": ("Photosynthesis. It happens in the leaves.", [1, 1], {"good": ["Correct term and location"]}),
            "3": ("Freezing. Yes it is reversible because ice can melt\nback into water.", [1, 1], {"good": ["Explains reversibility"]}),
            "4": ("Solid - stone, liquid - milk, gas - air", [1, 1], {}),
            "5": ("To remove germs from our hands.", [1, 0], {"why": ["", "Does not say how this prevents illness."], "miss": ["preventing illness"]}),
        }},
        {"no": "HS-2026-1055", "approved": True, "answers": {
            "1": ("sun light, water, air", [1, 1], {}),
            "2": ("photosinthesis, leaf", [1, 1], {"good": ["Correct term (spelling ignored)"]}),
            "3": ("freezing. it is reversible", [1, 1], {}),
            "4": ("solid liquid gas.  ice, water, steam", [1, 1], {}),
            "5": ("because our hands are dirty", [0, 0], {"why": "Says hands are dirty but does not mention germs or illness.", "miss": ["germs", "preventing illness"]}),
        }},
        {"no": "HS-2026-1058", "approved": True, "answers": {
            "1": ("Water and soil", [1, 0], {"why": ["", "Soil is not a raw material for making food."], "mis": ["Soil is food for the plant"]}),
            "2": ("Photosynthesis in the roots", [1, 0], {"why": ["", "Says roots instead of leaves."], "mis": ["Photosynthesis happens in the roots"]}),
            "3": ("Melting. it can not change back", [0, 0], {"why": "Names the change as melting and says it is not reversible.", "mis": ["Calling freezing 'melting'"], "miss": ["reversible change"]}),
            "4": ("Solid, liquid, gas. table, juice, smoke", [1, 1], {}),
            "5": ("to kill germs so we dont get sick", [1, 1], {"good": ["Links germs to illness"]}),
        }},
        {"no": "HS-2026-1076", "approved": True, "answers": {
            "1": ("sunlight and carbon dioxide", [1, 1], {"good": ["Uses the term carbon dioxide"]}),
            "2": ("photosynthesis", [1, 0], {"why": ["", "Does not say where it happens."], "miss": ["leaves"]}),
            "3": ("Freezing, reversible", [1, 1], {}),
            "4": ("solid - book\nliquid - oil", [0, 0], {"why": "Only two states are named; gas is missing.", "miss": ["gas"]}),
            "5": ("Germs on our hands can go into our mouth and make\nus ill.", [1, 1], {"good": ["Clear cause and effect"]}),
        }},
        {"no": "HS-2026-1082", "approved": True, "answers": {
            "1": ("sunlight", [1, 0], {"why": ["", "Only one need is named."], "miss": ["water", "carbon dioxide"]}),
            "2": ("fotosinthesis", [1, 0], {"why": ["", "Does not say where it happens."], "miss": ["leaves"]}),
            "3": ("it becomes ice when it is very cold", [0, 0], {
                "why": "Describes the change but does not name it, and does not say whether it is reversible.",
                "review": "The answer describes freezing in the student's own words; the teacher may accept it for C1.",
                "teacher": ([1, 0], "Describes freezing correctly in her own words — accepted for C1.")}),
            "4": ("solid, liquid, gas", [1, 0], {"why": ["", "No examples given."]}),
            "5": ("to keep clean and not fall sick from germs", [1, 1], {}),
        }},
    ],
}

MATHS = {
    "key": "maths",
    "name": "Unit Test 2 — Mathematics",
    "subject": "Mathematics",
    "grade_level": "Cambridge Primary, Stage 5",
    "instructions": "Show your working. Method marks are given even if the final answer is wrong.",
    "teacher": "Priya Raghavan",
    "results": "draft",
    "questions": [
        {"number": "1", "text": "Add: 345 + 278", "max": 1, "qtype": "math", "numeric": "623",
         "criteria": [("C1", "Correct sum 623", 1)], "ref": "623", "concepts": ["addition with carrying"], "alt": [], "misc": []},
        {"number": "2", "text": "48 pencils are packed equally into 6 boxes. How many pencils are in each box? Show your working.", "max": 2,
         "qtype": "math", "numeric": "8",
         "criteria": [("C1", "Uses division (48 ÷ 6) or an equivalent method", 1), ("C2", "Correct answer: 8 pencils", 1)],
         "ref": "48 ÷ 6 = 8 pencils", "concepts": ["division", "equal sharing"], "alt": ["6 × 8 = 48"], "misc": ["Subtracting instead of dividing"]},
        {"number": "3", "text": "Write 3/4 as a decimal and as a percentage.", "max": 2, "qtype": "math",
         "criteria": [("C1", "0.75", 1), ("C2", "75%", 1)], "ref": "0.75 and 75%", "concepts": ["fraction to decimal", "percentage"],
         "alt": [], "misc": ["Writing the digits of the fraction as a decimal (3/4 → 0.34)"]},
        {"number": "4", "text": "A rectangle is 8 cm long and 5 cm wide. Find its perimeter.", "max": 2, "qtype": "math", "numeric": "26", "unit": "cm",
         "criteria": [("C1", "Correct method: 2 × (8 + 5) or adds all four sides", 1), ("C2", "Correct answer with unit: 26 cm", 1)],
         "ref": "2 × (8 + 5) = 26 cm", "concepts": ["perimeter"], "alt": ["8 + 5 + 8 + 5 = 26 cm"], "misc": ["Finding the area instead of the perimeter"]},
        {"number": "5", "text": "Riya had ₹500. She spent ₹185 on books and ₹96 on a bag. How much money does she have left?", "max": 3,
         "qtype": "math", "numeric": "219",
         "criteria": [("C1", "Finds the total spent (281) or subtracts the first amount", 1), ("C2", "Subtracts from 500 correctly", 1),
                      ("C3", "Correct answer: ₹219", 1)],
         "ref": "185 + 96 = 281; 500 − 281 = ₹219", "concepts": ["two-step word problem", "subtraction"], "alt": ["500 − 185 = 315; 315 − 96 = 219"], "misc": []},
    ],
    "sheets": [
        {"no": "HS-2026-1041", "approved": True, "answers": {
            "1": ("623", [1], {}),
            "2": ("48 ÷ 6 = 8\n8 pencils", [1, 1], {"good": ["Clear working"]}),
            "3": ("0.75 and 75%", [1, 1], {}),
            "4": ("2 x (8 + 5) = 26 cm", [1, 1], {"good": ["Uses the perimeter formula"]}),
            "5": ("185 + 96 = 281\n500 - 281 = 229", [1, 1, 0], {"why": ["", "", "Subtraction slip: 500 − 281 is 219, not 229."], "miss": ["checking the answer"]}),
        }},
        {"no": "HS-2026-1055", "approved": False, "answers": {
            "1": ("613", [0], {"why": "Carrying error in the tens: the answer is 623.", "mis": ["Forgetting to carry in addition"]}),
            "2": ("8 pencils", [0, 1], {"why": ["No working shown.", ""], "review": "Correct answer without working; the teacher decides whether to give the method mark."}),
            "3": ("0.75 , 75%", [1, 1], {}),
            "4": ("8 + 5 + 8 + 5 = 26cm", [1, 1], {}),
            "5": ("500 - 185 = 315\n315 - 96 = 219\n₹219 left", [1, 1, 1], {"good": ["Correct alternative method"]}),
        }},
        {"no": "HS-2026-1076", "approved": True, "answers": {
            "1": ("623", [1], {}),
            "2": ("6 x 8 = 48 so 8 pencils", [1, 1], {"good": ["Checks with multiplication"]}),
            "3": ("0.34 and 34%", [0, 0], {"why": "Writes the digits of the fraction as a decimal.", "mis": ["Writing the digits of the fraction as a decimal (3/4 → 0.34)"]}),
            "4": ("8 x 5 = 40 cm", [0, 0], {"why": "Multiplies length by width — that is the area, not the perimeter.", "mis": ["Finding the area instead of the perimeter"]}),
            "5": ("185 + 96 = 281\n500 - 281 = 219", [1, 1, 1], {}),
        }},
        {"no": "HS-2026-1082", "approved": False, "answers": {
            "1": ("623", [1], {}),
            "2": ("48 - 6 = 42", [0, 0], {"why": "Subtracts instead of dividing.", "mis": ["Subtracting instead of dividing"]}),
            "3": ("0.75", [1, 0], {"why": ["", "Percentage not given."], "miss": ["percentage"]}),
            "4": ("26", [0, 1], {"why": ["No working shown.", "Unit (cm) missing."], "review": "Correct number but no working and no unit; check the marking rule for units."}),
            "5": ("500 - 185 = 315", [1, 0, 0], {"why": ["", "Does not subtract the ₹96.", "No final answer."], "miss": ["second step of the problem"]}),
        }},
        {"no": "HS-2026-1085", "approved": True, "answers": {
            "1": ("623", [1], {}),
            "2": ("48 ÷ 6 = 8", [1, 1], {}),
            "3": ("3/4 = 0.75 = 75 %", [1, 1], {}),
            "4": ("P = 2 (l + b)\n  = 2 (8 + 5)\n  = 26 cm", [1, 1], {"good": ["Formula, working and unit"]}),
            "5": ("185 + 96 = 281\n500 - 281 = 219\nRs 219", [1, 1, 1], {}),
        }},
    ],
}

def _def(n, text, what, why, ref, concepts, alt=(), misc=()):
    """A 4-mark definition question: 2 for the definition, 2 for its purpose / how it works."""
    return {"number": n, "text": text, "max": 4, "qtype": "long",
            "criteria": [("C1", what, 2), ("C2", why, 2)], "ref": ref, "concepts": list(concepts),
            "alt": list(alt), "misc": list(misc)}


# The test the school uploaded: real scans (question.pdf, ashwini.pdf, rohini.pdf, chandru.pdf).
# Marks are AI suggestions waiting for the teacher; nothing is approved yet.
MARKETING = {
    "key": "marketing",
    "name": "Marketing Basics — Test 1",
    "class": "Grade 12 · GDV",
    "section": "A",
    "subject": "Business Studies",
    "grade_level": "Cambridge AS Level, Business",
    "instructions": "Answer in your own words. Spelling and grammar are not assessed.",
    "teacher": None,
    "results": "draft",
    "questions": [
        _def("1", "What is lead generation?", "Identifying / attracting potential customers",
             "Purpose: interest, contact details, converting them into customers",
             "Finding and attracting potential customers interested in the company's products or services, collecting their details and converting them into customers.",
             ["potential customers", "interest", "conversion"]),
        _def("2", "What is sales?", "Selling products or services to customers",
             "Exchange for money / understanding needs and persuading the customer to buy",
             "Selling products or services to customers in exchange for money — understanding the customer's needs and persuading them to buy.",
             ["selling", "customers", "exchange for money"]),
        _def("3", "What is digital marketing?", "Promotion of products or services",
             "Through digital / online channels, with examples (website, social media, email, search)",
             "Promoting products or services through online platforms such as websites, social media, email and search engines.",
             ["promotion", "online channels"]),
        _def("4", "What is a target audience?", "A specific group of people",
             "Most likely to be interested in the product or service / whom the business wants to reach",
             "A specific group of people most likely to be interested in a company's product or service — the people the business wants to reach.",
             ["specific group", "likely to be interested"], misc=["A target audience is only social-media users"]),
        _def("5", "What is graphic design?", "Creating visual content",
             "Using images, colours, typography and layout to communicate a message or attract attention",
             "Creating visual content using images, colours, typography and layout to communicate a message (posters, logos, banners, social posts).",
             ["visual content", "communicate a message"]),
        {"number": "6", "text": "What are the tools used for lead generation?", "max": 5, "qtype": "long",
         "criteria": [("C1", "Names valid lead-generation tools (1 mark each, up to 3)", 3),
                      ("C2", "Explains how they help (finding prospects, contact details)", 2)],
         "ref": "e.g. LinkedIn (Sales Navigator), Apollo.io, HubSpot, ZoomInfo, Google search, Hunter, Prospeo — used to find potential customers and their contact details.",
         "concepts": ["named tools", "finding prospects"], "alt": ["Semrush", "Snov.io", "Lusha"], "misc": []},
    ],
    "sheets": [
        {"no": "HS-2026-1337", "approved": False, "identity": False, "pages": ["marketing-aswini-p1.jpg", "marketing-aswini-p2.jpg"],
         "name_on_sheet": "M. Aswini", "page_of": {"6": 2}, "warnings": ["page 2 is rotated 90°; read sideways"],
         "answers": {
            "1": ("Lead Generation: Lead generation is the process of finding potential customers. It helps a business get more customers.",
                  [2, 1], {"why": ["", "Says it gets more customers, but not how (interest, contact details, conversion)."], "miss": ["conversion"]}),
            "2": ("Sales: Sales is the process of selling the many products and services. It help on business earn and money.",
                  [2, 1], {"why": ["", "Mentions earning money but not the customer or their needs."], "miss": ["customer needs"]}),
            "3": ("Digital marketing: Digital marketing is promoting products or many services. It helps on online. It uses social media, websites and Google.",
                  [2, 2], {"good": ["Gives online channels as examples"]}),
            "4": ("Target Audience: A target audience is a group of social media peoples interested in a product or service. They are the people a business wants to reach.",
                  [1, 2], {"why": ["Limits the group to social-media users.", ""], "mis": ["A target audience is only social-media users"]}),
            "5": ("Graphic Design: Graphic design is creating visual content like posters, logos and banners. It helps attract people's most many attention.",
                  [2, 1], {"why": ["", "Attracting attention only; no images, colours, typography or message."], "miss": ["communicate a message"]}),
            "6": ("Tools used for Lead Generation: LinkedIn, Apollo and Google are some lead generation tools. They help find potential customers and their contact details.",
                  [3, 2], {"good": ["Three valid tools and their purpose"]}),
         }},
        {"no": "HS-2026-1338", "approved": False, "identity": False, "pages": ["marketing-rohini-p1.jpg", "marketing-rohini-p2.jpg"],
         "name_on_sheet": "Rohini N", "page_of": {"6": 2},
         "answers": {
            "1": ("Lead generation: Lead generation is the process finding potential customers, collecting their business contact details and creating interest in a company products or services in Lead generation.",
                  [2, 2], {"good": ["Mentions contact details and creating interest"]}),
            "2": ("Sales: * Sales mean understanding what a customer needs, explaining their right product or services and convincing them to buy it.\n* Sales - Understand, customer needs, Right products, Right customer - For sales convert.",
                  [2, 2], {"good": ["Explains the customer's needs and persuasion"]}),
            "3": ("Digital Marketing: * Digital marketing means promoting our products or services through digital platforms like Google, social media, websites and related the to reach to customers.\n* Eg - Digital marketing - promote the online products.",
                  [2, 2], {}),
            "4": ("Target Audience: * Target audience means by specific group of people how are interested in your services. In target people, Tarket clents and.",
                  [2, 1], {"why": ["", "The answer stops mid-sentence; 'most likely' / whom the business wants to reach is not clear."]}),
            "5": ("Graphic design: * Graphic Design is creating attractive designs, like the posters and social media post attract people, more information collect the designs.",
                  [2, 1], {"why": ["", "Says designs attract people; no images, colours, typography or message."], "miss": ["communicate a message"]}),
            "6": ("Lead generation tools: * Apollo.io * Sendburg * Prospeo.io * LinkedIn",
                  [3, 0], {"why": ["", "Lists tools but does not say how they help."], "miss": ["how the tools help"],
                           "review": "'Sendburg' is not a known lead-generation tool (possibly a misspelling); three other valid tools already earn C1."}),
         }},
        {"no": "HS-2026-1339", "approved": False, "identity": False, "pages": ["marketing-chandru-p1.jpg"], "name_on_sheet": None,
         "answers": {
            "1": ("Lead generation is the process of identifying and attracting potential customers who are interested in a company's products or service. It helps businesses find prospects and convert them into customers.",
                  [2, 2], {"good": ["Complete definition with conversion"]}),
            "2": ("Sales is the process of selling products or services to customers in exchange for money.", [2, 2], {}),
            "3": ("Digital Marketing is the promotion of products or services through online platform such as website, social media and email.", [2, 2], {}),
            "4": ("A target Audience is a specific group of people who are most likely to be interested in a company's product or service.", [2, 2], {}),
            "5": ("Graphic design is the process of creating visual content using images, colours, typography and layout to communicate a message.",
                  [2, 2], {"good": ["Names all the elements of design"]}),
            "6": ("LinkedIn, Apollo.io, Google Search, Semrush, Gmail, Google Map, HubSpot, Zoom info.",
                  [3, 0], {"why": ["", "A list only; how the tools help is not explained."], "miss": ["how the tools help"]}),
         }},
    ],
}

EXAMS = [SCIENCE, MATHS, MARKETING]

FEEDBACK_FULL = "Well done — clear and correct."
FEEDBACK_PART = "Good effort. Look again at the part you missed."
FEEDBACK_ZERO = "Let's go over this together in class."
