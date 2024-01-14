using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class ProductOptionService : IProductOptionService
{
    private readonly IProductOptionRepository _productOptionRepository;
    private readonly IModifierService _modifierService;

    public ProductOptionService(IProductOptionRepository productOptionRepository, IModifierService modifierService)
    {
        _productOptionRepository = productOptionRepository;
        _modifierService = modifierService;
    }

    public async Task<List<ProductOptionModel>> GetByProductId(int productId)
    {
        var productOptions = await _productOptionRepository.GetByProductId(productId);

        return await MapResultsToApi(productOptions);
    }

    private async Task<List<ProductOptionModel>> MapResultsToApi(IEnumerable<DAL.Models.ProductOptionModel> dataModel)
    {
        var result = new List<ProductOptionModel>();

        foreach (var dalProductOption in dataModel)
        {
            result.Add(await MapDalObjectToApiModel(dalProductOption));
        }

        return result;
    }

    private async Task<ProductOptionModel> MapDalObjectToApiModel(DAL.Models.ProductOptionModel dalProductOption)
    {
        return new ProductOptionModel
        {
            ProductOptionId = dalProductOption.ProductOptionId,
            ProductId = dalProductOption.ProductId,
            Name = dalProductOption.Name,
            Price = dalProductOption.Price,
            Quantity = dalProductOption.Quantity,
            Modifiers = await _modifierService.GetByProductOptionId(dalProductOption.ProductOptionId),
            LastModifiedDate = dalProductOption.LastModifiedDate,
            CreatedDate = dalProductOption.CreatedDate
        };
    }
}