export const SUPPORTED_FIELDS = [
    'name',
    'father_name',
    'email',
    'hostel',
    'hostel_id',
    'roll_no',
    'phone',
    'parent_number',
    'category',
    'blood_group',
    'state',
    'address',
    'pincode',
    'department',
    'cgpa',
    'joining_year',
    'individual_rank'
];

const ALIAS_DICT = {
    name: ['name', 'student name', 'full name', 'student_name', 'first name', 'fullname'],
    father_name: ['father name', 'fathers name', 'parent name', 'father_name'],
    email: ['email', 'email address', 'email id', 'student email'],
    hostel: ['hostel', 'hostel name', 'assigned hostel', 'hostel_name'],
    hostel_id: ['hostel id', 'hostel_id'],
    roll_no: ['roll number', 'roll no', 'registration number', 'reg no', 'roll_no', 'rollno', 'student id'],
    phone: ['phone', 'phone number', 'mobile', 'mobile number', 'contact', 'student contact'],
    parent_number: ['parent number', 'parent phone', 'emergency contact', 'father phone', 'parent_number'],
    category: ['category', 'caste category', 'caste'],
    blood_group: ['blood group', 'blood_group', 'bg'],
    state: ['state', 'domicile', 'home state'],
    address: ['address', 'home address', 'permanent address'],
    pincode: ['pincode', 'pin code', 'zip code', 'zip', 'postal code'],
    department: ['department', 'dept', 'branch', 'course', 'program', 'programme'],
    cgpa: ['cgpa', 'sgpa', 'gpa', 'marks', 'percentage'],
    joining_year: ['joining year', 'year joined', 'admission year', 'batch year', 'batch'],
    individual_rank: ['individual rank', 'rank', 'merit rank', 'merit no', 'individual_rank']
};

/**
 * Normalizes a header string for matching.
 * @param {string} header 
 * @returns {string}
 */
const normalizeHeader = (header) => {
    return header.toString().trim().toLowerCase().replace(/[^a-z0-9]/g, '');
};

/**
 * Detects mapping from CSV headers to DB fields.
 * @param {string[]} csvHeaders 
 * @returns {{ detectedMappings: Record<string, string>, unmappedFields: string[], unmappedColumns: string[] }}
 */
export const detectMappings = (csvHeaders) => {
    const detectedMappings = {};
    const unmappedColumns = [];
    const mappedDbFields = new Set();

    // Prepare normalized dictionary for fast matching
    const normalizedDict = {};
    for (const [dbField, aliases] of Object.entries(ALIAS_DICT)) {
        normalizedDict[dbField] = aliases.map(normalizeHeader);
        // Also add the field itself just in case
        normalizedDict[dbField].push(normalizeHeader(dbField));
    }

    csvHeaders.forEach(csvHeader => {
        const normHeader = normalizeHeader(csvHeader);
        let matchedField = null;

        for (const [dbField, aliases] of Object.entries(normalizedDict)) {
            if (aliases.includes(normHeader)) {
                matchedField = dbField;
                break;
            }
        }

        if (matchedField && !mappedDbFields.has(matchedField)) {
            detectedMappings[matchedField] = csvHeader;
            mappedDbFields.add(matchedField);
        } else {
            unmappedColumns.push(csvHeader);
        }
    });

    const unmappedFields = SUPPORTED_FIELDS.filter(field => !mappedDbFields.has(field));

    return {
        detectedMappings,
        unmappedFields,
        unmappedColumns
    };
};