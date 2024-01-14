using ordermateAPI.DAL.Interfaces;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Services;

public class ProductOptionService : IProductOptionService
{
    private readonly IProductOptionRepository _productOptionRepository;

    public ProductOptionService(IProductOptionRepository productOptionRepository)
    {
        _productOptionRepository = productOptionRepository;
    }

    public async Task<List<ProductOptionModel>> GetByProductId(int productId)
    {
        var productOptions = await _productOptionRepository.GetByProductId(productId);

        return MapResultsToApi(productOptions);
    }

    private List<ProductOptionModel> MapResultsToApi(IEnumerable<DAL.Models.ProductOptionModel> dataModel)
    {
        var result = new List<ProductOptionModel>();

        foreach (var dalProductOption in dataModel)
        {
            result.Add(MapDalObjectToApiModel(dalProductOption));
        }

        return result;
    }

    private ProductOptionModel MapDalObjectToApiModel(DAL.Models.ProductOptionModel dalProductOption)
    {
        return new ProductOptionModel
        {
            ProductOptionId = dalProductOption.ProductOptionId,
            ProductId = dalProductOption.ProductId,
            Name = dalProductOption.Name,
            Price = dalProductOption.Price,
            Quantity = dalProductOption.Quantity,
            LastModifiedDate = dalProductOption.LastModifiedDate,
            CreatedDate = dalProductOption.CreatedDate
        };
    }
}