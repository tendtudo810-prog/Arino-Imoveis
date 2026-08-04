const propertyData = {
  '1': {
    title: 'Casa moderna em Valparaíso',
    location: 'Valparaíso de Goiás - DF',
    image: 'pic1/house-isolated-field.jpg',
    description: 'Imóvel com 3 quartos, 2 banheiros, garagem, área gourmet e excelente conforto para a sua família.'
  },
  '2': {
    title: 'Apartamento confortável',
    location: 'Águas Claras - DF',
    image: 'pic1/house-isolated-field.jpg',
    description: 'Apartamento com 2 quartos, varanda, piscina e ótima localização para o seu dia a dia.'
  },
  '3': {
    title: 'Terreno amplo com vista',
    location: 'Taguatinga - DF',
    image: 'pic1/house-isolated-field.jpg',
    description: 'Terreno excelente para construir sua casa dos sonhos em uma região tranquila e segura.'
  },
  '4': {
    title: 'Casa moderna em Valparaíso',
    location: 'Valparaíso de Goiás - DF',
    image: 'pic1/house-isolated-field.jpg',
    description: 'Imóvel com 3 quartos, 2 banheiros, garagem, área gourmet e excelente conforto para a sua família.'
  },
  '5': {
    title: 'Apartamento confortável',
    location: 'Águas Claras - DF',
    image: 'pic1/house-isolated-field.jpg',
    description: 'Apartamento com 2 quartos, varanda, piscina e ótima localização para o seu dia a dia.'
  },
  '6': {
    title: 'Terreno amplo com vista',
    location: 'Taguatinga - DF',
    image: 'pic1/house-isolated-field.jpg',
    description: 'Terreno excelente para construir sua casa dos sonhos em uma região tranquila e segura.'
  }
};

function getQueryParam(name) {
  const params = new URLSearchParams(window.location.search);
  return params.get(name);
}

function loadPropertyDetails() {
  const id = getQueryParam('id') || '1';
  const property = propertyData[id] || propertyData['1'];

  document.querySelector('.page-title').textContent = property.title;
  document.querySelector('.page-location').textContent = property.location;
  document.querySelector('.property-image').src = property.image;
  document.querySelector('.property-image').alt = property.title;
  document.querySelector('.property-description').textContent = property.description;
}

document.addEventListener('DOMContentLoaded', loadPropertyDetails);
