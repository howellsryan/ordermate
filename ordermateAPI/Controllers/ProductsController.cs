using Microsoft.AspNetCore.Mvc;
using ordermateAPI.Models;
using ordermateAPI.Services.Interfaces;

namespace ordermateAPI.Controllers;

[ApiController]
[Route("api/[controller]")]
public class ProductsController : ControllerBase
{
    private readonly ILogger<ProductsController> _logger;
    private readonly IProductService _productService;

    public ProductsController(ILogger<ProductsController> logger, IProductService productService)
    {
        _logger = logger;
        _productService = productService;
    }

    [HttpGet]
    public async Task<ActionResult<List<ProductModel>>> Get()
    {
        try
        {
            var products = await _productService.Get();

            return Ok(products);
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }

    [HttpGet("{id}")]
    public async Task<ActionResult<ProductModel>> Get(int id)
    {
        try
        {
            var product = await _productService.Get(id);

            return Ok(product);
        }
        catch (Exception e)
        {
            return BadRequest(e.Message);
        }
    }
}