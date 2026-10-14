// Catálogo de espécies e raças dos pets. O front busca em GET /pets/options; os DTOs validam contra ele.
export const PET_BREEDS_BY_SPECIES: Record<string, string[]> = {
  Cachorro: ['Akita', 'Basset Hound', 'Beagle', 'Border Collie', 'Boxer', 'Bulldog Francês', 'Bulldog Inglês', 'Chihuahua', 'Chow Chow', 'Cocker Spaniel', 'Dachshund', 'Dálmata', 'Doberman', 'Fila Brasileiro', 'Golden Retriever', 'Husky Siberiano', 'Labrador', 'Lhasa Apso', 'Maltês', 'Outro', 'Pastor Alemão', 'Pastor Belga', 'Pequinês', 'Pinscher', 'Pitbull', 'Poodle', 'Pug', 'Rottweiler', 'São Bernardo', 'Schnauzer', 'Shih Tzu', 'Spitz Alemão', 'Vira-lata', 'Weimaraner', 'Yorkshire'],
  Cavalo: ['Andaluz', 'Appaloosa', 'Brasileiro de Hipismo', 'Campolina', 'Crioulo', 'Lusitano', 'Mangalarga Marchador', 'Mangalarga Paulista', 'Outro', 'Paint Horse', 'Pampa', 'Percheron', 'Pônei', 'Puro Sangue Árabe', 'Puro Sangue Inglês', 'Quarto de Milha', 'Shetland'],
  Galinha: ['Australorp', 'Bantam', 'Brahma', 'Caipira', 'Cochinchina', 'Leghorn', 'New Hampshire', 'Orpington', 'Outro', 'Paraíso Pedrês', 'Plymouth Rock', 'Rhode Island', 'Sussex'],
  Gato: ['Abissínio', 'American Shorthair', 'Angorá', 'Bengal', 'Birmanês', 'British Shorthair', 'Burmês', 'Exotic Shorthair', 'Himalaio', 'Maine Coon', 'Munchkin', 'Oriental', 'Outro', 'Persa', 'Ragamuffin', 'Ragdoll', 'Savannah', 'Scottish Fold', 'Siamês', 'Sphynx', 'Turkish Angora', 'Vira-lata'],
  Pomba: ['Asa-branca', 'Fantail', 'Juriti', 'Outro', 'Pomba-de-bando', 'Pomba-doméstica', 'Pomba-trocal', 'Pombo-correio', 'Rolinha'],
  Porco: ['Duroc', 'Hampshire', 'Landrace', 'Large White', 'Mini Pig', 'Outro', 'Pietrain', 'Porco Vietnamita'],
  Rato: ['Burmese', 'Dumbo', 'Hairless', 'Husky', 'Outro', 'Rato-doméstico', 'Rex', 'Satin', 'Twister'],
  Tartaruga: ['Cágado', 'Cágado-de-barbicha', 'Jabuti-piranga', 'Jabuti-tinga', 'Outro', 'Tartaruga-de-hermann', 'Tartaruga-leopardo', "Tigre-d'água"],
  Vaca: ['Angus', 'Brahman', 'Charolês', 'Gir', 'Girolando', 'Guzerá', 'Hereford', 'Holandesa', 'Jersey', 'Nelore', 'Outro', 'Simental'],
};

export const PET_SPECIES = Object.keys(PET_BREEDS_BY_SPECIES);

export const isBreedOfSpecies = (species: string, breed: string) => PET_BREEDS_BY_SPECIES[species]?.includes(breed) ?? false;
